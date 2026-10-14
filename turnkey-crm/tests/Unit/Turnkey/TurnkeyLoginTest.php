<?php

use Tests\Support\TurnkeyViewSandbox;

it('renders shared credentials only for the demo and removes disabled menu links', function () {
    foreach ([true, false] as $demo) {
        $app = TurnkeyViewSandbox::create($demo);
        try {
            $html = $app['view']->make('admin::sessions.login')->render();
            expect($html)->toContain('Turnkey CRM', '/turnkey/brand.css', '/admin/login', 'name="_token"');
            expect(str_contains($html, 'TurnkeyDemo!2026'))->toBe($demo);
            expect(str_contains($html, 'id="use-demo-account"'))->toBe($demo);
            expect(str_contains($html, 'Forgot password?'))->toBe(! $demo);
            $settings = array_filter($app['config']->get('menu.admin'), fn ($item) => $item['key'] === 'settings');
            expect(count($settings))->toBe($demo ? 0 : 1);
            expect($app->bound('db'))->toBeFalse();
        } finally {
            TurnkeyViewSandbox::close();
        }
    }
});
