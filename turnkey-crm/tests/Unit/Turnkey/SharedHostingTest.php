<?php

use Illuminate\Config\Repository;
use Illuminate\Events\Dispatcher;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Foundation\Application;
use Illuminate\Mail\Events\MessageSending;
use Illuminate\Support\Facades\Facade;
use Illuminate\View\ViewServiceProvider;
use Symfony\Component\Mime\Email;
use Webkul\Turnkey\Providers\TurnkeyServiceProvider;

it('configures symlink-free storage and suppresses outbound services only when opted in', function (bool $enabled) {
    $root = dirname(__DIR__, 3);
    $app = new Application($root);
    $app->usePublicPath('/test/htdocs');
    $app->instance('config', new Repository([
        'turnkey' => ['shared_hosting' => $enabled],
        'view' => ['paths' => [$root.'/resources/views'], 'compiled' => $root.'/storage/framework/views'],
        'filesystems' => ['links' => ['/old/link' => '/old/target'], 'disks' => ['public' => ['root' => '/old/root']]],
        'mail' => ['default' => 'smtp'],
    ]));
    $events = new Dispatcher($app);
    $events->listen('krayin.installed', fn () => throw new RuntimeException('Telemetry must not run'));
    $app->instance('events', $events);
    $app->instance('files', new Filesystem);
    Facade::clearResolvedInstances();
    Facade::setFacadeApplication($app);
    $app->register(ViewServiceProvider::class);

    try {
        $provider = new TurnkeyServiceProvider($app);
        $provider->register();
        $provider->boot();

        expect($app['config']->get('filesystems.links'))->toBe($enabled ? [] : ['/old/link' => '/old/target']);
        expect($app['config']->get('filesystems.disks.public.root'))->toBe($enabled ? '/test/htdocs/storage' : '/old/root');
        expect($app['config']->get('mail.default'))->toBe($enabled ? 'log' : 'smtp');
        expect($events->hasListeners('krayin.installed'))->toBe(! $enabled);
        expect($events->until(new MessageSending(new Email)))->toBe($enabled ? false : null);
        expect($app->bound('db'))->toBeFalse();
    } finally {
        Facade::clearResolvedInstances();
        Facade::setFacadeApplication(null);
        Application::setInstance(null);
    }
})->with([true, false]);
