<?php

namespace Webkul\Turnkey\Support;

use LogicException;
use RuntimeException;

final class HostedDemoSetup
{
    public const DATABASE = 'if0_43175351_turnkey';

    public static function assertTarget(array $target): void
    {
        if (rtrim($target['url'] ?? '', '/') !== 'https://turnkey-demo.is-great.org'
            || ! in_array($target['environment'] ?? '', ['installation', 'demo'], true)
            || ($target['shared_hosting'] ?? false) !== true
            || ! in_array($target['driver'] ?? '', ['mysql', 'mariadb'], true)
            || ($target['host'] ?? '') !== 'sql206.infinityfree.com'
            || ($target['database'] ?? '') !== self::DATABASE
            || ($target['prefix'] ?? null) !== '') {
            throw new LogicException('This setup page is restricted to the dedicated InfinityFree Turnkey demo.');
        }
    }

    public static function tokenMatches(mixed $expected, mixed $provided): bool
    {
        return is_string($expected) && preg_match('/\\A[a-f0-9]{64}\\z/', $expected)
            && is_string($provided) && hash_equals($expected, $provided);
    }

    public static function validForm(string $token, mixed $expiry, mixed $signature, int $now): bool
    {
        return is_string($expiry) && ctype_digit($expiry)
            && (int) $expiry >= $now && (int) $expiry <= $now + 900
            && is_string($signature)
            && hash_equals(hash_hmac('sha256', 'prepare-demo:'.$expiry, $token), $signature);
    }

    public static function readOnlyContents(string $contents): string
    {
        foreach (['APP_ENV' => 'demo', 'TURNKEY_DEMO' => 'true', 'APP_DEBUG' => 'false'] as $key => $value) {
            $pattern = '/^'.preg_quote($key, '/').'[ \\t]*=[^\\r\\n]*/m';
            if (preg_match_all($pattern, $contents) !== 1) {
                throw new LogicException('The environment file must contain exactly one '.$key.' setting.');
            }
            $contents = preg_replace($pattern, $key.'='.$value, $contents);
        }

        return $contents;
    }

    public static function activateReadOnly(string $path, string $original): void
    {
        $contents = self::readOnlyContents($original);
        if (file_get_contents($path) !== $original) {
            throw new LogicException('The environment file changed during preparation. Refresh before trying again.');
        }

        $temporary = tempnam(dirname($path), '.turnkey-env-');
        if ($temporary === false) {
            throw new RuntimeException('Cannot prepare the read-only environment file.');
        }

        try {
            if (! chmod($temporary, 0600)
                || file_put_contents($temporary, $contents, LOCK_EX) !== strlen($contents)) {
                throw new RuntimeException('Cannot write the read-only environment file.');
            }
            if (file_get_contents($path) !== $original) {
                throw new LogicException('The environment file changed during preparation. Refresh before trying again.');
            }
            if (! rename($temporary, $path)) {
                throw new RuntimeException('Cannot activate the read-only environment file.');
            }
        } finally {
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }
}
