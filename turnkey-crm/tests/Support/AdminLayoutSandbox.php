<?php

namespace Tests\Support;

use Illuminate\Auth\GenericUser;
use Illuminate\Contracts\Auth\Factory;
use Illuminate\Contracts\Auth\Guard;
use Illuminate\Foundation\Application;
use Mockery;
use Webkul\Core\Menu;
use Webkul\Core\Menu\MenuItem;

/** Full admin layout with fixture authentication/menu data; no app kernel or database. */
final class AdminLayoutSandbox
{
    public static function create(bool $collapsed = false): Application
    {
        $app = RecordListSandbox::create();
        $app['request']->cookies->set('sidebar_collapsed', $collapsed ? '1' : '0');
        $app['config']->set('test.denied_permissions', [
            'leads.create.quick-create', 'mail.compose.quick-create', 'contacts.persons.create.quick-create',
            'contacts.organizations.create.quick-create', 'products.create.quick-create',
        ]);
        $guard = Mockery::mock(Guard::class);
        $guard->shouldReceive('user')->andReturn(new GenericUser(['name' => 'Demo Manager', 'image' => null]));
        $auth = Mockery::mock(Factory::class);
        $auth->shouldReceive('guard')->andReturn($guard);
        $app->instance('auth', $auth);
        foreach (['dashboard.index', 'session.destroy', 'products.view', 'products.index', 'settings.index',
            'configuration.index', 'leads.search', 'quotes.search', 'products.search', 'contacts.persons.search',
            'settings.search', 'configuration.search', 'leads.store', 'contacts.persons.store',
            'contacts.organizations.store', 'products.store', 'mail.store'] as $name) {
            $app['router']->get('admin/'.str_replace('.', '/', $name).($name === 'products.view' ? '/{id}' : ''), fn () => null)->name('admin.'.$name);
        }
        $app['router']->getRoutes()->refreshNameLookups();
        $item = fn ($key, $name, $route, $children = []) => new MenuItem($key, $name, $route, route($route), 1, 'icon-contact', '', collect($children));
        $menu = Mockery::mock(Menu::class);
        $menu->shouldReceive('getItems')->andReturn(collect([
            $item('contacts', 'Contacts', 'admin.contacts.persons.index', [
                $item('contacts.persons', 'People', 'admin.contacts.persons.index'),
                $item('contacts.organizations', 'Companies', 'admin.contacts.organizations.index'),
            ]),
        ]));
        $app->instance('menu', $menu);

        return $app;
    }
}
