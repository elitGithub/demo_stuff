<?php

namespace Tests\Support;

use App\Services\FixtureService;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Illuminate\Support\Facades\DB;

trait BuildsSandboxRuntime
{
    protected string $fixtureDirectory;

    /**
     * @return void
     */
    protected function buildSandboxRuntime(): void
    {
        $this->fixtureDirectory = $this->runtime->path('fixtures');
        app(FixtureService::class)->build($this->fixtureDirectory);
        config(['demo.runtime_path' => $this->fixtureDirectory, 'demo.template_path' => $this->fixtureDirectory.'/template.sqlite', 'session.connection' => 'registry', 'session.secure' => false, 'session.path' => '/']);
        app(SandboxService::class)->prepareRegistry();
    }

    /**
     * @return Store
     */
    protected function sandboxSession(): Store
    {
        $session = new Store('test', new ArraySessionHandler(240));
        $session->start();

        return $session;
    }

    /**
     * @param  string  $name
     * @return void
     */
    protected function awaitSignal(string $name): void
    {
        $deadline = microtime(true) + 8;
        while (! file_exists($this->fixtureDirectory.'/'.$name) && microtime(true) < $deadline) {
            usleep(10000);
        }
        $this->assertFileExists($this->fixtureDirectory.'/'.$name);
    }

    /**
     * @param  string  $operation
     * @param  Store  $session
     * @param  string  $signal
     * @return string
     */
    protected function workerArguments(string $operation, Store $session, string $signal): string
    {
        DB::purge('visitor');

        return json_encode(['root' => $this->fixtureDirectory, 'operation' => $operation, 'session' => $session->all(), 'signal' => $signal, 'now' => CarbonImmutable::now()->toIso8601String()], JSON_THROW_ON_ERROR);
    }
}
