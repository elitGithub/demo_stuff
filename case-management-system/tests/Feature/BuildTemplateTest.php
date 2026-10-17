<?php

namespace Tests\Feature;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Schema;
use Pdo\Sqlite;
use RuntimeException;
use Tests\TestCase;

class BuildTemplateTest extends TestCase
{
    private string $path;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->path = storage_path('framework/testing/template-'.uniqid().'.sqlite');
    }

    /**
     * @return void
     */
    protected function tearDown(): void
    {
        File::delete($this->path);

        parent::tearDown();
    }

    /**
     * @return Sqlite
     */
    private function openReadOnly(): Sqlite
    {
        return new Sqlite('sqlite:'.$this->path, null, null, [Sqlite::ATTR_OPEN_FLAGS => Sqlite::OPEN_READONLY]);
    }

    /**
     * @return void
     */
    public function test_builds_a_migrated_and_seeded_template_at_the_given_path(): void
    {
        $migrations = array_map(fn (string $file): string => basename($file, '.php'), File::glob(database_path('migrations/*.php')));
        sort($migrations);
        $newest = end($migrations);

        $this->artisan('casefile:build-template', ['--path' => $this->path])
            ->expectsOutputToContain('16 cases, 43 mailbox messages, 20 script entries, schema '.$newest.'.')
            ->assertSuccessful();

        $this->assertFileExists($this->path);
        $this->assertFileDoesNotExist($this->path.'.building');
        $this->assertStringStartsWith('SQLite format 3', File::get($this->path));

        $pdo = $this->openReadOnly();
        $tables = $pdo->query("select name from sqlite_master where type = 'table'")->fetchAll(Sqlite::FETCH_COLUMN);

        foreach (['migrations', 'users', 'tracked_senders', 'cases', 'case_messages', 'attachments', 'case_events', 'mailbox_messages', 'mailbox_attachments', 'script_entries', 'case_number_sequence', 'installation_meta', 'notifications'] as $table) {
            $this->assertContains($table, $tables);
        }

        $this->assertSame(16, (int) $pdo->query('select count(*) from cases')->fetchColumn());
        $this->assertSame(5, (int) $pdo->query('select count(*) from tracked_senders')->fetchColumn());
        $this->assertSame(1, (int) $pdo->query('select count(*) from users')->fetchColumn());
        $this->assertSame(17, (int) $pdo->query('select next_number from case_number_sequence')->fetchColumn());
        $this->assertSame(8, (int) $pdo->query("select count(*) from script_entries where kind = 'delivery'")->fetchColumn());

        $schemaVersion = $pdo->query('select schema_version from installation_meta')->fetchColumn();
        $this->assertIsString($schemaVersion);
        $this->assertNotSame('', $schemaVersion);
        $this->assertSame($newest, $schemaVersion);
        $this->assertSame(1, (int) $pdo->query('select count(*) from installation_meta')->fetchColumn());

        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $this->assertFalse(Schema::hasTable('cases'));
    }

    /**
     * @return void
     */
    public function test_refuses_to_overwrite_an_existing_file_without_force(): void
    {
        File::put($this->path, 'keep me');

        $this->artisan('casefile:build-template', ['--path' => $this->path])
            ->expectsOutputToContain('Pass --force to replace it.')
            ->assertFailed();

        $this->assertSame('keep me', File::get($this->path));
        $this->assertFileDoesNotExist($this->path.'.building');
    }

    /**
     * @return void
     */
    public function test_force_replaces_an_existing_file_with_a_fresh_template(): void
    {
        File::put($this->path, 'old bytes');

        $this->artisan('casefile:build-template', ['--path' => $this->path, '--force' => true])->assertSuccessful();

        $this->assertStringStartsWith('SQLite format 3', File::get($this->path));
        $this->assertSame(16, (int) $this->openReadOnly()->query('select count(*) from cases')->fetchColumn());
    }

    /**
     * @return void
     */
    public function test_blank_path_fails_without_writing(): void
    {
        config(['casefile.sandbox.template' => $this->path]);
        File::put($this->path, 'untouched');

        foreach ([' ', ''] as $blank) {
            $this->artisan('casefile:build-template', ['--path' => $blank])
                ->expectsOutputToContain('needs a file path')
                ->assertFailed();
        }

        $this->assertFileDoesNotExist(base_path(' '));
        $this->assertFileDoesNotExist(base_path(' .building'));
        $this->assertFileDoesNotExist(base_path('.building'));
        $this->assertSame('untouched', File::get($this->path));
        $this->assertFileDoesNotExist($this->path.'.building');
    }

    /**
     * @return void
     */
    public function test_default_path_is_the_configured_template(): void
    {
        config(['casefile.sandbox.template' => $this->path]);

        $this->artisan('casefile:build-template')->assertSuccessful();

        $this->assertSame(16, (int) $this->openReadOnly()->query('select count(*) from cases')->fetchColumn());
    }

    /**
     * @return void
     */
    public function test_a_failed_build_leaves_no_file_behind(): void
    {
        config(['casefile.attachments.directory' => storage_path('framework/testing/missing-'.uniqid())]);

        try {
            $this->artisan('casefile:build-template', ['--path' => $this->path])->run();
            $this->fail('The build should fail when the fixture files are missing.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('run php artisan casefile:build-fixtures first', $exception->getMessage());
        }

        $this->assertFileDoesNotExist($this->path);
        $this->assertFileDoesNotExist($this->path.'.building');
    }

    /**
     * @return void
     */
    public function test_a_failure_before_migrating_leaves_no_building_file(): void
    {
        config(['database.connections.sqlite' => null]);

        try {
            $this->artisan('casefile:build-template', ['--path' => $this->path])->run();
            $this->fail('The build should fail without a sqlite connection to copy.');
        } catch (RuntimeException $exception) {
            $this->assertSame('The sqlite connection is not configured; the template connection copies it.', $exception->getMessage());
        }

        $this->assertFileDoesNotExist($this->path);
        $this->assertFileDoesNotExist($this->path.'.building');
        $this->assertNull(config('database.connections.template'));
    }
}
