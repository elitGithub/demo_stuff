<?php

use Illuminate\Support\HtmlString;
use Tests\Support\AdminLayoutSandbox;
use Tests\Support\TurnkeyViewSandbox;

it('loads the sidebar stylesheet in the full admin head before rendering navigation', function (bool $collapsed) {
    $app = AdminLayoutSandbox::create($collapsed);
    try {
        $html = $app['view']->make('admin::components.layouts.index', [
            'title' => 'Layout check', 'slot' => new HtmlString('<h1>Layout check</h1>'),
        ])->render();
        $head = explode('</head>', $html, 2)[0];
        expect($head)->toContain('href="http://localhost:8082/turnkey/sidebar.css"')
            ->and(substr_count($html, 'href="http://localhost:8082/turnkey/sidebar.css"'))->toBe(1)
            ->and($html)->toContain('id="admin-sidebar"')->toContain('v-turnkey-sidebar-template')
            ->and($app->bound('db'))->toBeFalse();
    } finally {
        Mockery::close();
        TurnkeyViewSandbox::close();
    }
})->with([false, true]);
