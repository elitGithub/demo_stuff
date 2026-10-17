<?php

namespace Tests;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Http;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        $cachedPaths = [
            dirname(__DIR__).'/bootstrap/cache/config.php',
            getenv('APP_CONFIG_CACHE') ?: null,
            $_ENV['APP_CONFIG_CACHE'] ?? null,
        ];
        foreach (array_filter($cachedPaths) as $path) {
            if (is_file($path)) {
                throw new RuntimeException('Tests refuse to run with cached application configuration.');
            }
        }

        parent::setUp();
        $this->withoutVite();
        Http::preventStrayRequests();
    }

    public function createApplication(): Application
    {
        $app = parent::createApplication();

        if (! $app->environment('testing')
            || $app['config']->get('database.default') !== 'sqlite'
            || $app['config']->get('database.connections.sqlite.database') !== ':memory:'
            || ! empty($app['config']->get('database.connections.sqlite.url'))) {
            throw new RuntimeException('Feature tests require isolated in-memory SQLite.');
        }

        return $app;
    }
}
