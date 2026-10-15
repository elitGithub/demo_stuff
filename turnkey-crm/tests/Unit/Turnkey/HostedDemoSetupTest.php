<?php

use Webkul\Turnkey\Support\DemoGuard;
use Webkul\Turnkey\Support\HostedDemoSetup;

it('allows only an explicitly named hosted database without relaxing repeat guards', function () {
    DemoGuard::assertCanSeed(true, 'if0_43175351_turnkey', false, false, 'if0_43175351_turnkey');
    expect(fn () => DemoGuard::assertCanSeed(true, 'customer', false, false, 'if0_43175351_turnkey'))->toThrow(LogicException::class);
    expect(fn () => DemoGuard::assertCanSeed(false, 'if0_43175351_turnkey', false, false, 'if0_43175351_turnkey'))->toThrow(LogicException::class);
    expect(fn () => DemoGuard::assertCanSeed(true, 'if0_43175351_turnkey', true, false, 'if0_43175351_turnkey'))->toThrow(LogicException::class);
    expect(fn () => DemoGuard::assertCanSeed(true, 'if0_43175351_turnkey', false, true, 'if0_43175351_turnkey'))->toThrow(LogicException::class);
});

it('validates the complete hosted target before any database work', function () {
    $target = [
        'url' => 'https://turnkey-demo.is-great.org',
        'environment' => 'installation',
        'shared_hosting' => true,
        'driver' => 'mysql',
        'host' => 'sql206.infinityfree.com',
        'database' => 'if0_43175351_turnkey',
        'prefix' => '',
    ];
    HostedDemoSetup::assertTarget($target);
    foreach ([
        'url' => 'https://customer.example',
        'environment' => 'production',
        'shared_hosting' => false,
        'driver' => 'sqlite',
        'host' => 'localhost',
        'database' => 'customer',
        'prefix' => 'customer_',
    ] as $key => $value) {
        expect(fn () => HostedDemoSetup::assertTarget(array_replace($target, [$key => $value])))->toThrow(LogicException::class);
    }
});

it('accepts only authenticated unexpired confirmation forms', function () {
    $token = str_repeat('a', 64);
    $expiry = '1900';
    $signature = hash_hmac('sha256', 'prepare-demo:'.$expiry, $token);
    expect(HostedDemoSetup::tokenMatches($token, $token))->toBeTrue();
    expect(HostedDemoSetup::tokenMatches('', ''))->toBeFalse();
    expect(HostedDemoSetup::tokenMatches($token, []))->toBeFalse();
    expect(HostedDemoSetup::validForm($token, $expiry, $signature, 1000))->toBeTrue();
    expect(HostedDemoSetup::validForm($token, $expiry, $signature, 1901))->toBeFalse();
    expect(HostedDemoSetup::validForm($token, $expiry, $signature, 999))->toBeFalse();
    expect(HostedDemoSetup::validForm($token, $expiry, 'wrong', 1000))->toBeFalse();
    expect(HostedDemoSetup::validForm($token, [], $signature, 1000))->toBeFalse();
});

it('switches only the demo flags and preserves credentials byte for byte', function () {
    $before = "APP_ENV=installation\r\nAPP_DEBUG=false\r\nTURNKEY_DEMO=false\r\nDB_PASSWORD=\"keep#this\$1\"\r\nAPP_KEY=base64:unchanged\r\n";
    $after = HostedDemoSetup::readOnlyContents($before);
    expect($after)->toContain("APP_ENV=demo\r\n", "TURNKEY_DEMO=true\r\n", "APP_DEBUG=false\r\n");
    expect($after)->toContain("DB_PASSWORD=\"keep#this\$1\"\r\nAPP_KEY=base64:unchanged\r\n");
    expect(HostedDemoSetup::readOnlyContents($after))->toBe($after);
    expect(fn () => HostedDemoSetup::readOnlyContents($before."APP_ENV=local\n"))->toThrow(LogicException::class);
    expect(fn () => HostedDemoSetup::readOnlyContents("APP_ENV=installation\n"))->toThrow(LogicException::class);
});

it('atomically changes an environment file and refuses concurrent edits', function () {
    $path = tempnam(sys_get_temp_dir(), 'turnkey-env-test-');
    $before = "APP_ENV=installation\nAPP_DEBUG=true\nTURNKEY_DEMO=false\nAPP_KEY=preserve\n";
    try {
        file_put_contents($path, $before);
        HostedDemoSetup::activateReadOnly($path, $before);
        expect(file_get_contents($path))->toBe(HostedDemoSetup::readOnlyContents($before));
        file_put_contents($path, $before."# operator edit\n");
        expect(fn () => HostedDemoSetup::activateReadOnly($path, $before))->toThrow(LogicException::class);
        expect(file_get_contents($path))->toContain('# operator edit');
    } finally {
        unlink($path);
    }
});
