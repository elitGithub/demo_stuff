<?php

use Webkul\Turnkey\Support\DemoGuard;

it('refuses disabled demo mode and a customer database before seeding', function () {
    expect(fn () => DemoGuard::assertCanSeed(false, 'turnkey_demo', false, false))->toThrow(LogicException::class);
    expect(fn () => DemoGuard::assertCanSeed(true, 'customer', false, false))->toThrow(LogicException::class);
    expect(fn () => DemoGuard::assertCanSeed(true, '', false, false))->toThrow(LogicException::class);
});

it('refuses repeat seeding and preexisting business data', function () {
    expect(fn () => DemoGuard::assertCanSeed(true, 'turnkey_demo', true, false))->toThrow(LogicException::class);
    expect(fn () => DemoGuard::assertCanSeed(true, 'turnkey_demo', false, true))->toThrow(LogicException::class);
});

it('accepts an explicitly enabled empty demo database', function () {
    DemoGuard::assertCanSeed(true, 'turnkey_demo', false, false);
    expect(true)->toBeTrue();
});
