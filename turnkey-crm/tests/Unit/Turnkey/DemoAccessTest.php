<?php

use Illuminate\Contracts\Auth\Factory;
use Illuminate\Foundation\Application;
use Webkul\Admin\Http\Middleware\Bouncer;
use Webkul\Turnkey\Support\DemoAccess;
use Webkul\User\Models\Role;
use Webkul\User\Models\User;

it('keeps sign in and the sales workflow usable', function () {
    foreach (['admin.session.store', 'admin.session.destroy', 'admin.leads.update', 'admin.activities.store', 'admin.contacts.persons.search', 'admin.quotes.print'] as $route) {
        expect(DemoAccess::allows($route, false))->toBeTrue($route);
    }
});

it('authorizes CRM form helpers through both the demo policy and native ACL', function () {
    $app = new Application(dirname(__DIR__, 3));
    $acl = require $app->basePath('packages/Webkul/Admin/src/Config/acl.php');
    $role = new Role(['permission_type' => 'custom', 'permissions' => DemoAccess::permissions($acl)]);
    $user = (new User)->setRelation('role', $role);
    $guard = Mockery::mock();
    $guard->shouldReceive('user')->andReturn($user);
    $auth = Mockery::mock(Factory::class);
    $auth->shouldReceive('guard')->with('user')->andReturn($guard);
    $app->instance('auth', $auth);
    $routes = collect($acl)->mapWithKeys(fn ($item) => array_fill_keys((array) $item['route'], $item['key']));
    $bouncer = new class extends Bouncer
    {
        public function permitsHelper(string $route, $routes): bool
        {
            return $this->isAuthorizedByFeature($route, $routes);
        }
    };

    try {
        foreach (['admin.settings.users.search', 'admin.settings.tags.search', 'admin.settings.attributes.lookup', 'admin.settings.attributes.lookup_entity', 'admin.settings.attributes.check_unique_validation'] as $route) {
            expect(DemoAccess::allows($route, false))->toBeTrue($route);
            expect($bouncer->permitsHelper($route, $routes))->toBeTrue($route);
        }
        expect($user->hasPermission('settings.user.users.edit'))->toBeFalse();
        expect(DemoAccess::allows('admin.settings.users.index', false))->toBeFalse();
        expect($app->bound('db'))->toBeFalse();
    } finally {
        Application::setInstance(null);
    }
});

it('blocks direct integration, account, configuration and upload actions', function () {
    foreach (['admin.settings.users.update', 'admin.settings.data_transfer.imports.import', 'admin.configuration.update', 'admin.user.account.update', 'admin.mail.store', 'admin.quotes.mail', 'admin.leads.quotes.mail', 'admin.forgot_password.store', 'installer.install', 'unknown.route'] as $route) {
        expect(DemoAccess::allows($route, false))->toBeFalse($route);
    }
    expect(DemoAccess::allows('admin.activities.store', true))->toBeFalse();
});
