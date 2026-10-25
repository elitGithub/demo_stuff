<?php

namespace Tests\Feature;

use App\Enums\SandboxStatus;
use App\Models\Registry\Sandbox;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Tests\Support\BuildsSandboxRuntime;
use Tests\Support\ConcurrentProcesses;
use Tests\TestCase;

class SandboxLifecycleTest extends TestCase
{
    use BuildsSandboxRuntime;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildSandboxRuntime();
    }

    /**
     * @return void
     */
    public function test_failed_copy_retains_a_reclaimable_slot(): void
    {
        config(['demo.template_path' => $this->fixtureDirectory.'/missing.sqlite']);
        try {
            app(SandboxService::class)->enter($this->sandboxSession(), '192.0.2.1', CarbonImmutable::now());
            $this->fail('Missing template was accepted.');
        } catch (\RuntimeException $exception) {
            $this->assertStringContainsString('template', $exception->getMessage());
        }
        $this->assertSame(SandboxStatus::Allocating, Sandbox::query()->sole()->status);
        $this->assertSame(1, Sandbox::query()->count());
        $this->assertSame(1, app(SandboxService::class)->reclaim(CarbonImmutable::now()));
        $this->assertSame(0, Sandbox::query()->count());
    }

    /**
     * @return void
     */
    public function test_twenty_sixth_allocation_is_rejected(): void
    {
        $service = app(SandboxService::class);
        for ($index = 0; $index < 25; $index++) {
            $service->enter($this->sandboxSession(), '192.0.2.'.$index, CarbonImmutable::now());
        }
        $this->assertSame(25, Sandbox::query()->count());
        $this->get('/')->assertOk();
        $this->post('/demo/enter')->assertStatus(429);
        $this->assertSame(25, Sandbox::query()->count());
        $this->assertCount(27, glob($this->fixtureDirectory.'/*.sqlite'));
    }

    /**
     * @return void
     */
    public function test_cleanup_cannot_delete_an_admitted_request(): void
    {
        $service = app(SandboxService::class);
        $session = $this->sandboxSession();
        $context = $service->enter($session, '192.0.2.1', CarbonImmutable::now());
        $arguments = $this->workerArguments('hold', $session, 'held');
        $process = ConcurrentProcesses::run(base_path('tests/Support/sandbox-worker.php'), new Collection([$arguments]))->sole();
        try {
            $this->awaitSignal('held');
            $this->assertSame(0, $service->reclaim(CarbonImmutable::now()->addHours(5)));
            $this->assertFileExists($service->path($context->digest.'.sqlite'));
            $this->assertSame(SandboxStatus::Retiring, Sandbox::query()->sole()->status);
        } finally {
            file_put_contents($this->fixtureDirectory.'/release', 'release');
            $process->wait();
        }
        $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput());
        $this->assertSame(1, $service->reclaim(CarbonImmutable::now()->addHours(5)));
        $this->assertFileDoesNotExist($service->path($context->digest.'.sqlite'));
        $this->assertSame(0, Sandbox::query()->count());
    }

    /**
     * @return void
     */
    public function test_waiting_admission_rechecks_retiring_state(): void
    {
        $service = app(SandboxService::class);
        $session = $this->sandboxSession();
        $service->enter($session, '192.0.2.1', CarbonImmutable::now());
        $holder = ConcurrentProcesses::run(base_path('tests/Support/sandbox-worker.php'), new Collection([$this->workerArguments('hold', $session, 'held')]))->sole();
        $waiter = null;
        try {
            $this->awaitSignal('held');
            $waiter = ConcurrentProcesses::run(base_path('tests/Support/sandbox-worker.php'), new Collection([$this->workerArguments('admit', $session, 'waiter')]))->sole();
            $this->awaitSignal('waiter-started');
            usleep(250000);
            Sandbox::query()->update(['status' => SandboxStatus::Retiring]);
        } finally {
            file_put_contents($this->fixtureDirectory.'/release', 'release');
            $holder->wait();
            $waiter?->wait();
        }
        $this->assertSame(0, $holder->getExitCode(), $holder->getErrorOutput());
        $this->assertSame(0, $waiter->getExitCode(), $waiter->getErrorOutput());
        $this->assertSame(410, json_decode($waiter->getOutput(), true, flags: JSON_THROW_ON_ERROR)['status']);
        $this->assertFileDoesNotExist($this->fixtureDirectory.'/waiter');
        $service->fixtures->configureConnection('visitor', $service->path(Sandbox::query()->sole()->digest.'.sqlite'), config('demo.limits.visitor_pages'));
        $this->assertSame(1, DB::connection('visitor')->table('sandbox_meta')->value('access_lock_version'));
    }

    /**
     * @return void
     */
    public function test_busy_timeout_is_retryable(): void
    {
        $session = $this->sandboxSession();
        app(SandboxService::class)->enter($session, '192.0.2.1', CarbonImmutable::now());
        $holder = ConcurrentProcesses::run(base_path('tests/Support/sandbox-worker.php'), new Collection([$this->workerArguments('hold', $session, 'held')]))->sole();
        try {
            $this->awaitSignal('held');
            $started = microtime(true);
            $busyResponse = $this->withSession($session->all())->get('/demo/ready');
            $duration = microtime(true) - $started;
            $busyResponse->assertStatus(503)->assertHeader('Retry-After', '2');
            $this->assertGreaterThan(1.8, $duration);
            $this->assertLessThan(5, $duration);
            $this->assertFileDoesNotExist($this->fixtureDirectory.'/waiter');
        } finally {
            file_put_contents($this->fixtureDirectory.'/release', 'release');
            $holder->wait();
        }
    }

    /**
     * @return void
     */
    public function test_page_cap_rolls_back_without_partial_rows(): void
    {
        $service = app(SandboxService::class);
        $service->enter($this->sandboxSession(), '192.0.2.1', CarbonImmutable::now());
        $connection = DB::connection('visitor');
        $this->assertSame(1024, $connection->selectOne('PRAGMA max_page_count')->max_page_count);
        $connection->statement('CREATE TABLE cap_probe (id INTEGER PRIMARY KEY, value BLOB NOT NULL)');
        try {
            $connection->transaction(function () use ($connection): void {
                $connection->table('cap_probe')->insert(['value' => 'small']);
                $connection->statement('INSERT INTO cap_probe(value) VALUES(zeroblob(4194304))');
            });
            $this->fail('SQLite page limit was exceeded.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString('full', $exception->getMessage());
        }
        $this->assertSame(0, $connection->table('cap_probe')->count());
        $this->assertSame(16, $connection->table('users')->count());
    }

    /**
     * @return void
     */
    public function test_cleanup_is_bounded_and_removes_incomplete_allocations_after_four_hours(): void
    {
        $now = CarbonImmutable::now();
        for ($index = 0; $index < 3; $index++) {
            Sandbox::query()->create(['digest' => hash('sha256', 'incomplete-'.$index), 'generation' => 'test', 'status' => SandboxStatus::Allocating, 'allocated_at' => $now, 'expires_at' => $now->addHours(4)]);
        }
        $service = app(SandboxService::class);
        $this->assertSame(0, $service->reclaim($now->addHours(3)));
        $this->assertSame(2, $service->reclaim($now->addHours(4)));
        $this->assertSame(1, Sandbox::query()->count());
        $this->assertSame(1, $service->reclaim($now->addHours(5)));
    }

    /**
     * @return void
     */
    public function test_expired_upload_reservations_are_reclaimed_without_touching_referenced_images(): void
    {
        $now = CarbonImmutable::now();
        $session = $this->sandboxSession();
        $service = app(SandboxService::class);
        $context = $service->enter($session, '192.0.2.1', $now);
        $key = hash('sha256', 'unattached').'.jpg';
        $attachedKey = hash('sha256', 'referenced').'.jpg';
        file_put_contents($service->path($key), 'fixture');
        file_put_contents($service->path($attachedKey), 'referenced fixture');
        DB::connection('registry')->table('sandbox_files')->insert(['sandbox_digest' => $context->digest, 'storage_key' => $key, 'status' => 'reserved', 'created_at' => $now->subHours(4)->utc()->toDateTimeString()]);
        DB::connection('registry')->table('sandbox_files')->insert(['sandbox_digest' => $context->digest, 'storage_key' => $attachedKey, 'status' => 'reserved', 'created_at' => $now->subHours(4)->utc()->toDateTimeString()]);
        DB::connection('visitor')->table('portfolio_images')->insert(['profile_id' => 1, 'storage_key' => $attachedKey, 'caption' => 'Test upload', 'position' => 3]);
        $service->reclaimUploads($now);
        $this->assertFileDoesNotExist($service->path($key));
        $this->assertFileExists($service->path($attachedKey));
        $this->assertSame('attached', DB::connection('registry')->table('sandbox_files')->sole()->status);
        $this->assertSame(1, Sandbox::query()->count());
    }

    /**
     * @return void
     */
    public function test_partial_failed_and_interrupted_allocations_release_their_slots_without_parsing_sqlite(): void
    {
        $now = CarbonImmutable::now();
        $service = app(SandboxService::class);
        $template = $this->fixtureDirectory.'/template.sqlite';
        $header = substr(file_get_contents($template), 0, 32);
        $brokenTemplate = $this->fixtureDirectory.'/broken-template.sqlite';
        file_put_contents($brokenTemplate, $header);
        config(['demo.template_path' => $brokenTemplate]);
        try {
            $service->enter($this->sandboxSession(), '192.0.2.1', $now);
            $this->fail('Truncated allocation was activated.');
        } catch (QueryException $exception) {
            $this->assertNotSame('', $exception->getMessage());
        }
        $failed = Sandbox::query()->sole();
        $this->assertSame(SandboxStatus::Allocating, $failed->status);
        $this->assertSame($header, file_get_contents($service->path($failed->digest.'.sqlite')));
        $interruptedDigest = hash('sha256', 'interrupted-copy');
        Sandbox::query()->create(['digest' => $interruptedDigest, 'generation' => 'interrupted', 'status' => SandboxStatus::Allocating, 'allocated_at' => $now->subHours(5), 'expires_at' => $now->subHour()]);
        file_put_contents($service->path($interruptedDigest.'.sqlite'), $header);
        file_put_contents($service->path($interruptedDigest.'.sqlite-journal'), 'interrupted journal');
        $this->assertSame(2, $service->reclaim($now));
        $this->assertFileDoesNotExist($service->path($failed->digest.'.sqlite'));
        $this->assertFileDoesNotExist($service->path($interruptedDigest.'.sqlite'));
        $this->assertFileDoesNotExist($service->path($interruptedDigest.'.sqlite-journal'));
        $this->assertSame(0, Sandbox::query()->count());
        config(['demo.template_path' => $template]);
        $healthy = $service->enter($this->sandboxSession(), '192.0.2.2', $now);
        $this->assertSame(SandboxStatus::Active, Sandbox::query()->whereKey($healthy->digest)->sole()->status);
        $this->assertFileExists($service->path($healthy->digest.'.sqlite'));
    }

    /**
     * @return void
     */
    public function test_one_cleanup_call_shares_eight_upload_records_across_all_paths(): void
    {
        $now = CarbonImmutable::now();
        $service = app(SandboxService::class);
        $contexts = [];
        for ($index = 0; $index < 3; $index++) {
            $contexts[] = $service->enter($this->sandboxSession(), '192.0.2.'.$index, $now);
        }
        DB::purge('visitor');
        foreach ($contexts as $index => $context) {
            $uploadCount = $index < 2 ? 8 : 4;
            if ($index < 2) {
                Sandbox::query()->whereKey($context->digest)->update(['status' => SandboxStatus::Retiring, 'expires_at' => $now->subMinutes(3 - $index)]);
            }
            for ($uploadIndex = 0; $uploadIndex < $uploadCount; $uploadIndex++) {
                $storageKey = hash('sha256', $index.'-'.$uploadIndex).'.jpg';
                file_put_contents($service->path($storageKey), 'fixture');
                DB::connection('registry')->table('sandbox_files')->insert(['sandbox_digest' => $context->digest, 'storage_key' => $storageKey, 'status' => $index < 2 ? 'attached' : 'reserved', 'created_at' => $now->subHours(5)]);
            }
        }
        $this->assertSame(20, DB::connection('registry')->table('sandbox_files')->count());
        $this->assertSame(1, $service->reclaim($now));
        $this->assertSame(12, DB::connection('registry')->table('sandbox_files')->count());
        $this->assertSame(2, Sandbox::query()->count());
        $this->assertSame(4, DB::connection('registry')->table('sandbox_files')->where('status', 'reserved')->count());
        $this->assertSame(1, $service->reclaim($now));
        $this->assertSame(4, DB::connection('registry')->table('sandbox_files')->count());
        $this->assertSame(0, $service->reclaim($now));
        $this->assertSame(0, DB::connection('registry')->table('sandbox_files')->count());
        $this->assertSame(SandboxStatus::Active, Sandbox::query()->sole()->status);
    }

    /**
     * @return void
     */
    public function test_busy_retired_upload_work_consumes_the_shared_budget(): void
    {
        $now = CarbonImmutable::now();
        $service = app(SandboxService::class);
        $session = $this->sandboxSession();
        $held = $service->enter($session, '192.0.2.1', $now);
        $active = $service->enter($this->sandboxSession(), '192.0.2.2', $now);
        for ($index = 0; $index < 8; $index++) {
            DB::connection('registry')->table('sandbox_files')->insert(['sandbox_digest' => $held->digest, 'storage_key' => hash('sha256', 'held-'.$index).'.jpg', 'status' => 'attached', 'created_at' => $now->subHours(5)]);
        }
        $reservedKey = hash('sha256', 'reserved-active').'.jpg';
        file_put_contents($service->path($reservedKey), 'fixture');
        DB::connection('registry')->table('sandbox_files')->insert(['sandbox_digest' => $active->digest, 'storage_key' => $reservedKey, 'status' => 'reserved', 'created_at' => $now->subHours(5)]);
        $holder = ConcurrentProcesses::run(base_path('tests/Support/sandbox-worker.php'), new Collection([$this->workerArguments('hold', $session, 'held')]))->sole();
        try {
            $this->awaitSignal('held');
            Sandbox::query()->whereKey($held->digest)->update(['status' => SandboxStatus::Retiring]);
            $this->assertSame(0, $service->reclaim($now));
            $this->assertSame(9, DB::connection('registry')->table('sandbox_files')->count());
            $this->assertFileExists($service->path($reservedKey));
        } finally {
            file_put_contents($this->fixtureDirectory.'/release', 'release');
            $holder->wait();
        }
        $this->assertSame(0, $holder->getExitCode(), $holder->getErrorOutput());
        $this->assertSame(1, $service->reclaim($now));
        $this->assertSame(1, DB::connection('registry')->table('sandbox_files')->count());
        $this->assertSame(0, $service->reclaim($now));
        $this->assertSame(0, DB::connection('registry')->table('sandbox_files')->count());
    }
}
