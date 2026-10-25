<?php

namespace Tests;

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use RuntimeException;
use Tests\Support\TemporaryRuntime;

abstract class TestCase extends BaseTestCase
{
    protected ?TemporaryRuntime $runtime = null;

    protected bool $applicationBootstrapStarted = false;

    /** @var array<string, array{process: string|false, env: mixed, server: mixed}> */
    protected array $originalEnvironment = [];

    /**
     * @return Application
     *
     * @throws RuntimeException
     */
    public function createApplication(): Application
    {
        $base = dirname(__DIR__);
        $configuredCache = getenv('APP_CONFIG_CACHE');

        if (file_exists($base.'/bootstrap/cache/config.php') ||
            ($configuredCache !== false && $configuredCache !== '' && file_exists($configuredCache))) {
            throw new RuntimeException('Tests refuse cached application configuration.');
        }

        if ($this->runtime === null) {
            $this->runtime = TemporaryRuntime::create();
        }

        $registryPath = getenv('TEST_REGISTRY_DATABASE');
        $visitorPath = getenv('TEST_VISITOR_DATABASE');
        $registryPath = $registryPath === false ? $this->runtime->path('registry.sqlite') : $registryPath;
        $visitorPath = $visitorPath === false ? $this->runtime->path('visitor.sqlite') : $visitorPath;
        $this->runtime->assertOwnedPath($registryPath);
        $this->runtime->assertOwnedPath($visitorPath);

        $storage = $this->runtime->path('storage');

        foreach (['framework/views', 'framework/sessions', 'framework/cache/data', 'logs', 'app/demo-runtime'] as $directory) {
            $path = $storage.'/'.$directory;
            $this->runtime->assertOwnedPath($path);

            if (! is_dir($path) && ! mkdir($path, 0700, true)) {
                throw new RuntimeException('Cannot prepare isolated Laravel storage.');
            }
        }

        $environment = [
            'APP_ENV' => 'testing',
            'APP_KEY' => 'base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            'APP_DEBUG' => 'false',
            'LOG_CHANNEL' => 'null',
            'LARAVEL_STORAGE_PATH' => $storage,
            'APP_CONFIG_CACHE' => $this->runtime->path('config.php'),
            'APP_EVENTS_CACHE' => $this->runtime->path('events.php'),
            'APP_ROUTES_CACHE' => $this->runtime->path('routes.php'),
            'APP_SERVICES_CACHE' => $this->runtime->path('services.php'),
            'APP_PACKAGES_CACHE' => $this->runtime->path('packages.php'),
            'VIEW_COMPILED_PATH' => $this->runtime->path('storage/framework/views'),
        ];

        foreach ($environment as $name => $value) {
            if (! array_key_exists($name, $this->originalEnvironment)) {
                $this->originalEnvironment[$name] = [
                    'process' => getenv($name),
                    'env' => $_ENV[$name] ?? null,
                    'server' => $_SERVER[$name] ?? null,
                ];
            }

            putenv($name.'='.$value);
            $_ENV[$name] = $value;
            $_SERVER[$name] = $value;
        }

        $this->applicationBootstrapStarted = true;
        $application = require $base.'/bootstrap/app.php';
        $application->loadEnvironmentFrom('.env.testing');
        $application->useStoragePath($storage);
        $this->traitsUsedByTest = class_uses_recursive(static::class);

        $application->afterBootstrapping(LoadConfiguration::class, function (Application $application) use ($registryPath, $visitorPath): void {
            $application->make('config')->set('database', [
                'default' => 'test_visitor',
                'connections' => [
                    'test_registry' => [
                        'driver' => 'sqlite',
                        'database' => $registryPath,
                        'prefix' => '',
                        'foreign_key_constraints' => true,
                    ],
                    'test_visitor' => [
                        'driver' => 'sqlite',
                        'database' => $visitorPath,
                        'prefix' => '',
                        'foreign_key_constraints' => true,
                    ],
                ],
                'migrations' => ['table' => 'migrations', 'update_date_on_publish' => true],
            ]);
            $application->make('config')->set('session.connection', 'test_registry');
            $application->make('config')->set('logging.default', 'null');
        });

        $application->make(Kernel::class)->bootstrap();
        Http::preventStrayRequests();
        Mail::fake();

        return $application;
    }

    /**
     * @return void
     */
    protected function tearDown(): void
    {
        try {
            parent::tearDown();
        } finally {
            foreach ($this->originalEnvironment as $name => $original) {
                if ($original['process'] === false) {
                    putenv($name);
                } else {
                    putenv($name.'='.$original['process']);
                }

                if ($original['env'] === null) {
                    unset($_ENV[$name]);
                } else {
                    $_ENV[$name] = $original['env'];
                }

                if ($original['server'] === null) {
                    unset($_SERVER[$name]);
                } else {
                    $_SERVER[$name] = $original['server'];
                }
            }

            if ($this->runtime !== null) {
                $this->runtime->destroy();
            }
        }
    }
}
