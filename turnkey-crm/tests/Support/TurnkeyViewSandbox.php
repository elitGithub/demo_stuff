<?php

namespace Tests\Support;

use Illuminate\Config\Repository;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Illuminate\Support\Facades\Facade;
use Illuminate\Support\ViewErrorBag;
use Illuminate\Translation\TranslationServiceProvider;
use Illuminate\View\ViewServiceProvider;
use Webkul\Core\Core;
use Webkul\Turnkey\Providers\TurnkeyServiceProvider;

/** Render real Blade views and shipped assets without a kernel, .env or database. */
final class TurnkeyViewSandbox
{
    public static function create(bool $demo, string $url = 'http://localhost:8082'): Application
    {
        $root = dirname(__DIR__, 2);
        require_once $root.'/packages/Webkul/Core/src/Http/helpers.php';
        $app = new Application($root);
        $app->instance('config', new Repository([
            'app' => ['name' => 'Turnkey CRM', 'locale' => 'en', 'fallback_locale' => 'en', 'url' => $url],
            'view' => ['paths' => [$root.'/resources/views'], 'compiled' => $root.'/storage/framework/views'],
            'krayin-vite' => require $root.'/config/krayin-vite.php',
            'turnkey' => ['demo' => $demo, 'demo_email' => 'demo@turnkey.example', 'demo_password' => 'TurnkeyDemo!2026'],
            'menu' => ['admin' => require $root.'/packages/Webkul/Admin/src/Config/menu.php'],
        ]));
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication($app);
        $app->instance('files', new Filesystem);
        $app->instance('request', Request::create($url.'/admin/login'));
        $session = new Store('turnkey-preview', new ArraySessionHandler(120));
        $session->start();
        $app->instance('session', $session);
        $app->instance('session.store', $session);
        $app['request']->setLaravelSession($session);
        $app->instance('core', new class extends Core
        {
            public function __construct() {}

            public function getConfigData(string $field): mixed
            {
                return null;
            }
        });
        $app->register(ViewServiceProvider::class);
        $app->register(TranslationServiceProvider::class);
        $app['translator']->addNamespace('admin', $root.'/packages/Webkul/Admin/src/Resources/lang');
        $app['view']->share('errors', new ViewErrorBag);
        $app['view']->addNamespace('admin', $root.'/packages/Webkul/Admin/src/Resources/views');
        $app['blade.compiler']->anonymousComponentPath($root.'/packages/Webkul/Admin/src/Resources/views/components', 'admin');
        $app['router']->post('admin/login', fn () => null)->name('admin.session.store');
        $app['router']->get('admin/forget-password', fn () => null)->name('admin.forgot_password.create');
        $app['router']->getRoutes()->refreshNameLookups();
        $provider = new TurnkeyServiceProvider($app);
        $provider->register();
        $provider->boot();

        return $app;
    }

    public static function close(): void
    {
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication(null);
        Application::setInstance(null);
    }
}
