<?php

namespace Webkul\Turnkey\Support;

use LogicException;

final class DemoGuard
{
    public static function assertCanSeed(bool $enabled, string $database, bool $seeded, bool $hasBusinessData, ?string $approvedDatabase = null): void
    {
        $dedicated = $approvedDatabase === null
            ? (bool) preg_match('/\A[a-zA-Z0-9_]+_demo\z/', $database)
            : (bool) preg_match('/\A[a-zA-Z0-9_]+\z/', $approvedDatabase) && hash_equals($approvedDatabase, $database);

        if (! $enabled || ! $dedicated) {
            throw new LogicException('Enable TURNKEY_DEMO and use a dedicated database ending in _demo or the explicitly approved hosted database.');
        }

        if ($seeded || $hasBusinessData) {
            throw new LogicException('Demo preparation requires an empty business dataset and may only run once. No data was changed.');
        }
    }
}
