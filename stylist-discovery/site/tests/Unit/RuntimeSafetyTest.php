<?php

namespace Tests\Unit;

use Illuminate\Foundation\Testing\Attributes\UnitTest;
use Illuminate\Http\Client\StrayRequestException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use RuntimeException;
use Tests\Support\TemporaryRuntime;
use Tests\TestCase;

class RuntimeSafetyTest extends TestCase
{
    /**
     * @return void
     */
    public function test_boot_does_not_connect_to_an_application_database(): void
    {
        $this->assertSame([], $this->app->make('db')->getConnections());
        $this->get('/')->assertStatus(503)->assertCookieMissing('strand_city_session');
        $this->assertSame(['test_registry'], array_keys($this->app->make('db')->getConnections()));
        $this->assertInstanceOf(\Closure::class, $this->app->make('db')->connection('test_registry')->getRawPdo());
        $this->assertFileDoesNotExist($this->runtime->path('registry.sqlite'));
        $this->assertFileDoesNotExist($this->runtime->path('visitor.sqlite'));
        $this->assertFileDoesNotExist($this->runtime->path('storage/app/demo-runtime/registry.sqlite'));
        $this->assertFileDoesNotExist($this->runtime->path('storage/app/demo-runtime/template.sqlite'));
        $this->assertSame('.env.testing', $this->app->environmentFile());
        $this->assertSame('test_visitor', config('database.default'));
        $this->assertSame(['test_registry', 'test_visitor'], array_keys(config('database.connections')));
        $this->assertSame('null', config('queue.default'));
        Mail::assertNothingSent();
    }

    /**
     * @return void
     */
    #[UnitTest]
    public function test_external_runtime_path_is_rejected(): void
    {
        $originalPath = getenv('TEST_REGISTRY_DATABASE');
        putenv('TEST_REGISTRY_DATABASE=/var/www/demo_stuff/beauty_saloon_management/database/database.sqlite');

        try {
            $this->createApplication();
            $this->fail('An external database path was accepted.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Test paths must remain beneath the generated runtime.', $exception->getMessage());
            $this->assertFalse($this->applicationBootstrapStarted);
            $this->assertNull($this->app);
        } finally {
            if ($originalPath === false) {
                putenv('TEST_REGISTRY_DATABASE');
            } else {
                putenv('TEST_REGISTRY_DATABASE='.$originalPath);
            }
        }
    }

    /**
     * @return void
     */
    #[UnitTest]
    public function test_cached_configuration_is_rejected(): void
    {
        $this->runtime = TemporaryRuntime::create();
        $cache = $this->runtime->path('config.php');
        file_put_contents($cache, '<?php throw new RuntimeException("Cached PHP must never execute.");');
        $originalCache = getenv('APP_CONFIG_CACHE');
        putenv('APP_CONFIG_CACHE='.$cache);

        try {
            $this->createApplication();
            $this->fail('Cached configuration was accepted.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Tests refuse cached application configuration.', $exception->getMessage());
            $this->assertFalse($this->applicationBootstrapStarted);
            $this->assertNull($this->app);
        } finally {
            if ($originalCache === false) {
                putenv('APP_CONFIG_CACHE');
            } else {
                putenv('APP_CONFIG_CACHE='.$originalCache);
            }
        }
    }

    /**
     * @return void
     */
    #[UnitTest]
    public function test_traversal_and_absolute_paths_are_rejected(): void
    {
        $this->runtime = TemporaryRuntime::create();

        foreach (['../registry.sqlite', '/tmp/registry.sqlite', 'nested/../../registry.sqlite', '', './registry.sqlite'] as $relative) {
            try {
                $this->runtime->path($relative);
                $this->fail('An unsafe test path was accepted.');
            } catch (RuntimeException $exception) {
                $this->assertNotSame('', $exception->getMessage());
            }
        }
    }

    /**
     * @return void
     */
    #[UnitTest]
    public function test_symbolic_link_paths_are_rejected_and_cleanup_preserves_the_target(): void
    {
        $this->runtime = TemporaryRuntime::create();
        $target = TemporaryRuntime::create();
        $targetFile = $target->path('untouched.txt');
        file_put_contents($targetFile, 'untouched');
        symlink(dirname($targetFile), $this->runtime->path('escape'));

        try {
            $this->runtime->path('escape/untouched.txt');
            $this->fail('A symbolic link was accepted.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Test paths must not contain symbolic links.', $exception->getMessage());
            $this->runtime->destroy();
            $this->assertSame('untouched', file_get_contents($targetFile));
        } finally {
            $target->destroy();
        }
    }

    /**
     * @return void
     */
    public function test_stray_http_requests_are_blocked(): void
    {
        $this->expectException(StrayRequestException::class);
        Http::get('https://outside.example/forbidden');
    }
}
