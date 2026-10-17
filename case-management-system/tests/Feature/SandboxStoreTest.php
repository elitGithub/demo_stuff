<?php

namespace Tests\Feature;

use App\Exceptions\SandboxLimitReached;
use App\Sandbox\SandboxStore;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Sleep;
use InvalidArgumentException;
use Pdo\Sqlite;
use RuntimeException;
use Tests\Support\BuildsTemplateFile;
use Tests\TestCase;

class SandboxStoreTest extends TestCase
{
    use BuildsTemplateFile;

    private const string FORMAT = 'Y-m-d H:i:s';

    private const string CLIENT = '203.0.113.7';

    private const string LIMIT_COPY = 'Too many demo sessions from this address; try again in an hour.';

    private const string LIMIT_KEY = 'sandbox:203.0.113.7';

    private const array SHIFTED = [
        'cases' => ['received_at', 'closed_at', 'created_at', 'updated_at'],
        'case_messages' => ['sent_at', 'created_at', 'updated_at'],
        'case_events' => ['occurred_at', 'created_at', 'updated_at'],
        'mailbox_messages' => ['received_at', 'created_at', 'updated_at'],
        'notifications' => ['created_at', 'updated_at', 'read_at'],
    ];

    private string $template;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->template = $this->buildTemplate();
    }

    /**
     * @param  string  $path
     * @return Sqlite
     */
    private function open(string $path): Sqlite
    {
        return new Sqlite('sqlite:'.$path);
    }

    /**
     * @return string
     */
    private function directory(): string
    {
        return config('casefile.sandbox.directory');
    }

    /**
     * @param  int  $hoursAgo
     * @return string
     */
    private function fakeSandbox(int $hoursAgo): string
    {
        $path = $this->directory().'/'.bin2hex(random_bytes(16)).'.sqlite';

        File::ensureDirectoryExists($this->directory());
        File::put($path, 'sandbox');
        touch($path, CarbonImmutable::now()->subHours($hoursAgo)->getTimestamp());

        return $path;
    }

    /**
     * @return list<string>
     */
    private function sandboxFiles(): array
    {
        return File::glob($this->directory().'/*.sqlite');
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_provision_copies_the_template_and_moves_only_the_listed_dates(): void
    {
        $template = $this->open($this->template);
        $seededAt = $template->query('select seeded_at from installation_meta')->fetchColumn();
        $now = CarbonImmutable::createFromFormat(self::FORMAT, $seededAt)->addDays(9)->addHours(5)->addMinutes(7)->addSeconds(11);
        $this->travelTo($now);

        $handle = app(SandboxStore::class)->provision(self::CLIENT);
        $sandbox = $this->open($handle->path);
        $seconds = CarbonImmutable::createFromFormat(self::FORMAT, $now->format(self::FORMAT), 'UTC')->getTimestamp()
            - CarbonImmutable::createFromFormat(self::FORMAT, $seededAt, 'UTC')->getTimestamp();
        $schema = 'select type, name, tbl_name, sql from sqlite_master order by name';

        $this->assertSame($template->query($schema)->fetchAll(Sqlite::FETCH_ASSOC), $sandbox->query($schema)->fetchAll(Sqlite::FETCH_ASSOC));

        $moved = 0;

        foreach ($template->query("select name from sqlite_master where type = 'table' order by name")->fetchAll(Sqlite::FETCH_COLUMN) as $table) {
            $original = $template->query('select * from '.$table.' order by rowid')->fetchAll(Sqlite::FETCH_ASSOC);
            $copied = $sandbox->query('select * from '.$table.' order by rowid')->fetchAll(Sqlite::FETCH_ASSOC);
            $this->assertCount(count($original), $copied, $table);

            foreach ($original as $index => $row) {
                foreach ($row as $column => $value) {
                    $expected = match (true) {
                        $table === 'installation_meta' && $column === 'dates_shifted_to' => $now->format(self::FORMAT),
                        $value !== null && in_array($column, self::SHIFTED[$table] ?? [], true) => CarbonImmutable::createFromFormat(self::FORMAT, $value, 'UTC')->addSeconds($seconds)->format(self::FORMAT),
                        default => $value,
                    };

                    $moved += $expected !== $value ? 1 : 0;
                    $this->assertSame($expected, $copied[$index][$column], $table.'.'.$column);
                }
            }
        }

        $this->assertGreaterThan(300, $moved);
        $this->assertNull($template->query('select dates_shifted_to from installation_meta')->fetchColumn());
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_provision_writes_a_private_file_under_a_new_private_directory(): void
    {
        $this->assertDirectoryDoesNotExist($this->directory());

        $handle = app(SandboxStore::class)->provision(self::CLIENT);

        $this->assertMatchesRegularExpression('/\A[0-9a-f]{32}\z/', $handle->id);
        $this->assertSame($this->directory().DIRECTORY_SEPARATOR.$handle->id.'.sqlite', $handle->path);
        $this->assertFileExists($handle->path);
        $this->assertSame('0600', substr(sprintf('%o', fileperms($handle->path)), -4));
        $this->assertSame('0700', substr(sprintf('%o', fileperms($this->directory())), -4));
        $this->assertNotSame($handle->id, app(SandboxStore::class)->provision(self::CLIENT)->id);
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_resolve_returns_the_sandbox_it_provisioned(): void
    {
        $handle = app(SandboxStore::class)->provision(self::CLIENT);

        $this->assertEquals($handle, app(SandboxStore::class)->resolve($handle->id));
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_resolve_of_an_unknown_or_malformed_id_is_null(): void
    {
        $store = app(SandboxStore::class);
        $known = $store->provision(self::CLIENT)->id;

        foreach ([bin2hex(random_bytes(16)), '', '../template', strtoupper($known), substr($known, 1), $known.'0', $known."\n", str_repeat('g', 32), '../'.substr($known, 3)] as $id) {
            $this->assertNull($store->resolve($id), 'id '.json_encode($id));
        }
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_resolve_retires_a_sandbox_whose_schema_version_differs_from_the_template(): void
    {
        $handle = app(SandboxStore::class)->provision(self::CLIENT);
        $this->open($handle->path)->exec("update installation_meta set schema_version = 'stale'");

        $this->assertNull(app(SandboxStore::class)->resolve($handle->id));
        $this->assertFileExists($handle->path);
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_a_redeployed_template_with_a_newer_schema_retires_existing_sandboxes(): void
    {
        $handle = app(SandboxStore::class)->provision(self::CLIENT);
        $this->open($this->template)->exec("update installation_meta set schema_version = 'newer'");

        $this->assertNull(app(SandboxStore::class)->resolve($handle->id));

        $fresh = app(SandboxStore::class)->provision(self::CLIENT);
        $this->assertEquals($fresh, app(SandboxStore::class)->resolve($fresh->id));
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_resolve_retires_a_sandbox_with_no_installation_row(): void
    {
        $handle = app(SandboxStore::class)->provision(self::CLIENT);
        $this->open($handle->path)->exec('delete from installation_meta');

        $this->assertNull(app(SandboxStore::class)->resolve($handle->id));
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_resolve_reads_the_template_version_once_per_store(): void
    {
        $store = app(SandboxStore::class);
        $handle = $store->provision(self::CLIENT);

        $this->assertNotNull($store->resolve($handle->id));
        $this->open($this->template)->exec("update installation_meta set schema_version = 'newer'");

        $this->assertNotNull($store->resolve($handle->id));
        $this->assertNull(app(SandboxStore::class)->resolve($handle->id));
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_resolve_fails_loudly_when_the_template_is_missing(): void
    {
        $handle = app(SandboxStore::class)->provision(self::CLIENT);
        File::delete($this->template);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('The sandbox template is missing at '.$this->template);

        app(SandboxStore::class)->resolve($handle->id);
    }

    /**
     * @see App\Sandbox\SandboxStore::discard()
     */
    public function test_discard_removes_the_file(): void
    {
        $store = app(SandboxStore::class);
        $kept = $store->provision(self::CLIENT);
        $gone = $store->provision(self::CLIENT);

        $store->discard($gone->id);

        $this->assertFileDoesNotExist($gone->path);
        $this->assertFileExists($kept->path);
        $this->assertNull($store->resolve($gone->id));
    }

    /**
     * @see App\Sandbox\SandboxStore::discard()
     */
    public function test_discard_refuses_a_malformed_id_and_deletes_nothing(): void
    {
        $handle = app(SandboxStore::class)->provision(self::CLIENT);

        foreach (['../'.basename($this->template, '.sqlite'), '', $handle->id."\n"] as $id) {
            try {
                app(SandboxStore::class)->discard($id);
                $this->fail('discard should refuse '.json_encode($id));
            } catch (InvalidArgumentException $exception) {
                $this->assertSame('A sandbox id is 32 lowercase hexadecimal characters.', $exception->getMessage());
            }
        }

        $this->assertFileExists($this->template);
        $this->assertFileExists($handle->path);
    }

    /**
     * @see App\Sandbox\SandboxStore::sweep()
     */
    public function test_sweep_removes_files_older_than_the_ttl_and_keeps_younger_ones(): void
    {
        $expired = $this->fakeSandbox(25);
        $young = $this->fakeSandbox(23);
        $unrelated = $this->directory().'/keep-me.sqlite';
        File::put($unrelated, 'not a sandbox');
        touch($unrelated, CarbonImmutable::now()->subHours(48)->getTimestamp());

        $this->assertSame(1, app(SandboxStore::class)->sweep());

        $this->assertFileDoesNotExist($expired);
        $this->assertFileExists($young);
        $this->assertFileExists($unrelated);
    }

    /**
     * @see App\Sandbox\SandboxStore::sweep()
     */
    public function test_sweep_follows_the_configured_ttl(): void
    {
        config(['casefile.sandbox.ttl_hours' => 2]);
        $expired = $this->fakeSandbox(3);
        $young = $this->fakeSandbox(1);

        $this->assertSame(1, app(SandboxStore::class)->sweep());
        $this->assertFileDoesNotExist($expired);
        $this->assertFileExists($young);
    }

    /**
     * @see App\Sandbox\SandboxStore::sweep()
     */
    public function test_sweep_above_the_cap_removes_the_oldest(): void
    {
        config(['casefile.sandbox.cap' => 2]);
        $oldest = $this->fakeSandbox(3);
        $middle = $this->fakeSandbox(2);
        $newest = $this->fakeSandbox(1);

        $this->assertSame(1, app(SandboxStore::class)->sweep());

        $this->assertFileDoesNotExist($oldest);
        $this->assertFileExists($middle);
        $this->assertFileExists($newest);
        $this->assertSame(0, app(SandboxStore::class)->sweep());
    }

    /**
     * @see App\Sandbox\SandboxStore::sweep()
     */
    public function test_sweep_applies_the_ttl_before_counting_against_the_cap(): void
    {
        config(['casefile.sandbox.cap' => 2]);
        $expired = $this->fakeSandbox(30);
        $older = $this->fakeSandbox(5);
        $newer = $this->fakeSandbox(4);

        $this->assertSame(1, app(SandboxStore::class)->sweep());

        $this->assertFileDoesNotExist($expired);
        $this->assertFileExists($older);
        $this->assertFileExists($newer);
    }

    /**
     * @see App\Sandbox\SandboxStore::sweep()
     */
    public function test_sweep_of_a_missing_directory_creates_it_and_removes_nothing(): void
    {
        $this->assertSame(0, app(SandboxStore::class)->sweep());
        $this->assertDirectoryExists($this->directory());
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_provision_at_the_cap_makes_room_so_the_cap_holds_afterwards(): void
    {
        config(['casefile.sandbox.cap' => 2]);
        $expired = $this->fakeSandbox(26);
        $oldest = $this->fakeSandbox(2);
        $newest = $this->fakeSandbox(1);

        $handle = app(SandboxStore::class)->provision(self::CLIENT);

        $this->assertFileDoesNotExist($expired);
        $this->assertFileDoesNotExist($oldest);
        $this->assertFileExists($newest);
        $this->assertFileExists($handle->path);
        $this->assertCount(2, $this->sandboxFiles());
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_the_sixth_provision_in_an_hour_for_one_address_is_refused(): void
    {
        $this->freezeSecond();
        $store = app(SandboxStore::class);

        for ($attempt = 1; $attempt <= 5; $attempt++) {
            $store->provision(self::CLIENT);
        }

        try {
            $store->provision(self::CLIENT);
            $this->fail('The sixth provision should be refused.');
        } catch (SandboxLimitReached $exception) {
            $this->assertSame(self::LIMIT_COPY, $exception->getMessage());
            $this->assertSame(3600, $exception->retryAfterSeconds);
        }

        $this->assertCount(5, $this->sandboxFiles());
        $this->assertSame(5, RateLimiter::attempts(self::LIMIT_KEY));
        $this->assertFileExists($store->provision('198.51.100.4')->path);

        $this->travel(3599)->seconds();

        try {
            $store->provision(self::CLIENT);
            $this->fail('The limit should still hold one second before the hour is up.');
        } catch (SandboxLimitReached) {
            $this->assertCount(6, $this->sandboxFiles());
        }

        $this->travel(2)->seconds();
        $this->assertFileExists($store->provision(self::CLIENT)->path);
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_the_attempt_is_counted_before_the_template_is_copied(): void
    {
        File::partialMock()->shouldReceive('copy')->once()->andReturnUsing(function (string $from, string $to): bool {
            $this->assertSame(1, RateLimiter::attempts(self::LIMIT_KEY));

            return copy($from, $to);
        });

        app(SandboxStore::class)->provision(self::CLIENT);

        $this->assertSame(1, RateLimiter::attempts(self::LIMIT_KEY));
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_provisioning_waits_for_a_held_lock_and_then_runs(): void
    {
        Sleep::fake(syncWithCarbon: true);
        $holder = Cache::lock('casefile-sandbox-provision', 60);
        $this->assertTrue($holder->get());
        $waits = 0;

        Sleep::whenFakingSleep(function () use ($holder, &$waits): void {
            $waits++;
            $this->assertSame(0, RateLimiter::attempts(self::LIMIT_KEY));
            $this->assertSame([], $this->sandboxFiles());
            $holder->release();
        });

        $handle = app(SandboxStore::class)->provision(self::CLIENT);

        $this->assertSame(1, $waits);
        $this->assertFileExists($handle->path);
        $this->assertSame(1, RateLimiter::attempts(self::LIMIT_KEY));
        $this->assertTrue(Cache::lock('casefile-sandbox-provision', 60)->get());
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_provisioning_gives_up_when_the_lock_stays_held(): void
    {
        Sleep::fake(syncWithCarbon: true);
        $this->assertTrue(Cache::lock('casefile-sandbox-provision', 60)->get());

        try {
            app(SandboxStore::class)->provision(self::CLIENT);
            $this->fail('Provisioning should give up while another provision holds the lock.');
        } catch (LockTimeoutException) {
            $this->assertSame([], $this->sandboxFiles());
            $this->assertSame(0, RateLimiter::attempts(self::LIMIT_KEY));
        }
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_a_provision_that_fails_part_way_removes_its_file_and_its_attempt(): void
    {
        $this->open($this->template)->exec('delete from installation_meta');

        try {
            app(SandboxStore::class)->provision(self::CLIENT);
            $this->fail('A template without a seed time cannot be shifted.');
        } catch (RuntimeException $exception) {
            $this->assertNotInstanceOf(SandboxLimitReached::class, $exception);
            $this->assertStringContainsString('has no installation_meta.seeded_at to shift from.', $exception->getMessage());
        }

        $this->assertDirectoryExists($this->directory());
        $this->assertSame([], File::glob($this->directory().'/*'));
        $this->assertSame(0, RateLimiter::attempts(self::LIMIT_KEY));
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_successful_partial_cleanup_preserves_the_original_provisioning_exception(): void
    {
        $original = new RuntimeException('Template copying failed.');
        $filesystem = File::getFacadeRoot();
        File::partialMock()->shouldReceive('copy')->once()->andThrow($original);

        try {
            app(SandboxStore::class)->provision(self::CLIENT);
            $this->fail('The copy failure should escape provisioning.');
        } catch (RuntimeException $exception) {
            $this->assertSame($original, $exception);
        } finally {
            File::swap($filesystem);
        }

        $this->assertSame([], $this->sandboxFiles());
        $this->assertSame(0, RateLimiter::attempts(self::LIMIT_KEY));
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_failed_partial_cleanup_reports_the_orphan_and_preserves_the_provisioning_exception(): void
    {
        $original = new RuntimeException('Template copying failed.');
        $filesystem = File::getFacadeRoot();
        $partial = null;
        $mock = File::partialMock();
        $mock->shouldReceive('copy')->once()->andThrow($original);
        $mock->shouldReceive('delete')->once()->andReturnUsing(function (string $path) use (&$partial): bool {
            $partial = $path;

            return false;
        });

        try {
            app(SandboxStore::class)->provision(self::CLIENT);
            $this->fail('A partial sandbox that cannot be removed must be reported.');
        } catch (RuntimeException $exception) {
            $this->assertNotNull($partial);
            $this->assertSame('Could not delete the sandbox at '.$partial.'.', $exception->getMessage());
            $this->assertSame($original, $exception->getPrevious());
        } finally {
            File::swap($filesystem);
        }

        $this->assertFileExists($partial);
        $this->assertSame([$partial], $this->sandboxFiles());
        $this->assertSame(0, RateLimiter::attempts(self::LIMIT_KEY));
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_a_replacement_removes_the_old_sandbox_only_once_the_limit_allows_it(): void
    {
        $store = app(SandboxStore::class);
        $old = $store->provision(self::CLIENT);
        $new = $store->provision(self::CLIENT, $old->id);

        $this->assertFileDoesNotExist($old->path);
        $this->assertFileExists($new->path);
        $this->assertCount(1, $this->sandboxFiles());

        config(['casefile.sandbox.provisions_per_hour' => 2]);

        try {
            $store->provision(self::CLIENT, $new->id);
            $this->fail('The third provision should be refused.');
        } catch (SandboxLimitReached) {
            $this->assertFileExists($new->path);
        }
    }

    /**
     * @see App\Sandbox\SandboxStore::start()
     */
    public function test_start_attaches_and_remembers_the_sandbox_once_per_request(): void
    {
        $session = app('session.store');
        $session->start();
        $store = app(SandboxStore::class);

        $first = $store->start($session, self::CLIENT);

        $this->assertSame($first->id, $session->get(config('casefile.sandbox.session_key')));
        $this->assertSame($first->path, DB::connection()->getDatabaseName());
        $this->assertEquals($first, $store->start($session, self::CLIENT));
        $this->assertSame(1, RateLimiter::attempts(self::LIMIT_KEY));

        $session->save();
        $second = $store->start($session, self::CLIENT);

        $this->assertNotSame($first->id, $second->id);
        $this->assertFileDoesNotExist($first->path);
        $this->assertSame($second->id, $session->get(config('casefile.sandbox.session_key')));
        $this->assertSame($second->path, DB::connection()->getDatabaseName());
        $this->assertSame(2, RateLimiter::attempts(self::LIMIT_KEY));
        $this->assertCount(1, $this->sandboxFiles());
    }

    /**
     * @see App\Sandbox\SandboxStore::finish()
     */
    public function test_finish_discards_only_the_sandbox_started_in_the_same_request(): void
    {
        $session = app('session.store');
        $session->start();
        $store = app(SandboxStore::class);
        $handle = $store->start($session, self::CLIENT);

        $store->finish($session);

        $this->assertFileDoesNotExist($handle->path);

        $session->forget(config('casefile.sandbox.session_key'));
        $store->finish($session);
        $this->assertSame([], $this->sandboxFiles());
    }

    /**
     * @see App\Sandbox\SandboxStore::finish()
     */
    public function test_finish_leaves_a_sandbox_from_an_earlier_request_for_sweeping(): void
    {
        $session = app('session.store');
        $session->start();
        $store = app(SandboxStore::class);
        $handle = $store->start($session, self::CLIENT);
        $session->save();

        $store->finish($session);

        $this->assertFileExists($handle->path);
    }

    /**
     * @see App\Sandbox\SandboxStore::discard()
     */
    public function test_a_sandbox_that_cannot_be_deleted_is_reported_not_skipped(): void
    {
        if (posix_geteuid() === 0) {
            $this->markTestSkipped('File permissions do not bind the root user.');
        }

        $store = app(SandboxStore::class);
        $handle = $store->provision(self::CLIENT);
        $expired = $this->fakeSandbox(30);
        chmod($this->directory(), 0500);

        try {
            foreach ([fn () => $store->discard($handle->id), fn () => $store->sweep(), fn () => $store->provision(self::CLIENT)] as $index => $action) {
                try {
                    $action();
                    $this->fail('Action '.$index.' should report the file it could not delete.');
                } catch (RuntimeException $exception) {
                    $this->assertMatchesRegularExpression('~\ACould not delete the sandbox at '.preg_quote($this->directory(), '~').'/[0-9a-f]{32}\.sqlite\.\z~', $exception->getMessage());
                }
            }

            $this->assertSame(1, RateLimiter::attempts(self::LIMIT_KEY));
        } finally {
            chmod($this->directory(), 0700);
        }

        $this->assertFileExists($handle->path);
        $this->assertFileExists($expired);
        $this->assertCount(2, $this->sandboxFiles());
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_resolve_treats_a_sandbox_older_than_the_ttl_as_expired(): void
    {
        $handle = app(SandboxStore::class)->provision(self::CLIENT);

        touch($handle->path, CarbonImmutable::now()->subHours(25)->getTimestamp());
        $this->assertNull(app(SandboxStore::class)->resolve($handle->id));

        touch($handle->path, CarbonImmutable::now()->subHours(23)->getTimestamp());
        $this->assertEquals($handle, app(SandboxStore::class)->resolve($handle->id));
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_the_limit_follows_the_configured_count(): void
    {
        config(['casefile.sandbox.provisions_per_hour' => 2]);
        $store = app(SandboxStore::class);
        $store->provision(self::CLIENT);
        $store->provision(self::CLIENT);

        $this->expectException(SandboxLimitReached::class);

        $store->provision(self::CLIENT);
    }

    /**
     * @see App\Sandbox\SandboxStore::provision()
     */
    public function test_provision_fails_loudly_without_a_template_and_writes_nothing(): void
    {
        File::delete($this->template);

        try {
            app(SandboxStore::class)->provision(self::CLIENT);
            $this->fail('Provisioning without a template should fail.');
        } catch (RuntimeException $exception) {
            $this->assertNotInstanceOf(SandboxLimitReached::class, $exception);
            $this->assertSame('The sandbox template is missing at '.$this->template.'. Build it with php artisan casefile:build-template.', $exception->getMessage());
        }

        $this->assertSame([], File::glob($this->directory().'/*'));
    }

    /**
     * @see App\Sandbox\SandboxStore::attach()
     */
    public function test_attach_points_the_default_connection_at_the_sandbox(): void
    {
        $store = app(SandboxStore::class);
        $handle = $store->provision(self::CLIENT);

        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        config(['database.connections.sqlite.url' => 'sqlite:'.$this->template]);

        $store->attach($handle);

        $this->assertNull(config('database.connections.sqlite.url'));
        $this->assertSame($handle->path, DB::connection()->getDatabaseName());
        $this->assertSame(16, DB::table('cases')->count());
        $this->assertNotNull(DB::table('installation_meta')->value('dates_shifted_to'));

        DB::table('users')->where('id', 1)->update(['name' => 'Written through the app']);
        $this->assertSame('Written through the app', $this->open($handle->path)->query('select name from users where id = 1')->fetchColumn());
        $this->assertSame('Dana Whitfield', $this->open($this->template)->query('select name from users where id = 1')->fetchColumn());
    }

    /**
     * @see bootstrap/app.php
     */
    public function test_the_sixth_sign_in_from_one_address_renders_the_sandbox_limit_page(): void
    {
        config(['casefile.mode' => 'demo']);
        $store = app(SandboxStore::class);

        for ($attempt = 1; $attempt <= 5; $attempt++) {
            $store->provision('127.0.0.1');
        }

        $this->post('/sign-in/google')
            ->assertStatus(429)
            ->assertSee(self::LIMIT_COPY)
            ->assertDontSee('Too many attempts from this address. Try again in a minute.');

        $this->assertGuest();
        $this->assertCount(5, $this->sandboxFiles());
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
    }

    /**
     * @see bootstrap/app.php
     */
    public function test_the_limit_response_sends_retry_after_and_answers_json_in_json(): void
    {
        config(['casefile.mode' => 'demo']);
        $store = app(SandboxStore::class);

        for ($attempt = 1; $attempt <= 5; $attempt++) {
            $store->provision('127.0.0.1');
        }

        $this->postJson('/sign-in/google')
            ->assertStatus(429)
            ->assertExactJson(['message' => self::LIMIT_COPY])
            ->assertHeader('Retry-After', '3600');

        $this->post('/sign-in/google')
            ->assertStatus(429)
            ->assertHeader('Retry-After', '3600')
            ->assertHeader('Content-Type', 'text/html; charset=utf-8')
            ->assertSee(self::LIMIT_COPY);

        $this->assertGuest();
    }

    /**
     * @see resources/views/errors/429.blade.php
     */
    public function test_the_limit_page_falls_back_to_the_sign_in_copy_without_a_notice(): void
    {
        $this->view('errors.429')
            ->assertSee('Too many attempts from this address. Try again in a minute.')
            ->assertDontSee(self::LIMIT_COPY);

        $this->view('errors.429', ['notice' => self::LIMIT_COPY])
            ->assertSee(self::LIMIT_COPY)
            ->assertDontSee('Too many attempts from this address. Try again in a minute.');
    }
}
