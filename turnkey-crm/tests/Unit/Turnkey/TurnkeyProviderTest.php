<?php

use Illuminate\Config\Repository;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Facade;
use Illuminate\View\ViewServiceProvider;
use Webkul\Turnkey\Providers\TurnkeyServiceProvider;

it('overrides both admin pages and anonymous components without booting the CRM', function () {
    $root = dirname(__DIR__, 3);
    $app = new Application($root);
    $app->instance('config', new Repository([
        'app' => ['name' => 'Turnkey CRM'],
        'view' => ['paths' => [$root.'/resources/views'], 'compiled' => $root.'/storage/framework/views'],
    ]));
    Facade::clearResolvedInstances();
    Facade::setFacadeApplication($app);
    $app->instance('files', new Filesystem);
    $app->register(ViewServiceProvider::class);
    $app['view']->addNamespace('admin', $root.'/packages/Webkul/Admin/src/Resources/views');
    $app['blade.compiler']->anonymousComponentPath($root.'/packages/Webkul/Admin/src/Resources/views/components', 'admin');
    $provider = new TurnkeyServiceProvider($app);
    $provider->register();
    $provider->boot();

    expect(realpath($app['view']->getFinder()->find('admin::sessions.login')))->toContain('Turnkey/src/Resources/views/admin/sessions/login');
    preg_match("/'view' => '([^']+)'/", $app['blade.compiler']->compileString('<x-admin::layouts.header />'), $header);
    expect(realpath($app['view']->getFinder()->find($header[1])))->toContain('Turnkey/src/Resources/views/admin/components/layouts/header/index');
    preg_match("/'view' => '([^']+)'/", $app['blade.compiler']->compileString('<x-admin::form />'), $form);
    expect(realpath($app['view']->getFinder()->find($form[1])))->toContain('Admin/src/Resources/views/components/form/index');
    expect($app->bound('db'))->toBeFalse();

    Facade::clearResolvedInstances();
    Facade::setFacadeApplication(null);
    Application::setInstance(null);
});
