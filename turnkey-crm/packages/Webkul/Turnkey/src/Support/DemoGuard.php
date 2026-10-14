<?php

namespace Webkul\Turnkey\Support;

use LogicException;

final class DemoGuard
{
    public static function assertCanSeed(bool $enabled, string $database, bool $seeded, bool $hasBusinessData): void
    {
        if (! $enabled || ! preg_match('/\A[a-zA-Z0-9_]+_demo\z/', $database)) {
            throw new LogicException('Enable TURNKEY_DEMO and use a dedicated database whose name ends in _demo.');
        }

        if ($seeded || $hasBusinessData) {
            throw new LogicException('Demo preparation requires an empty business dataset and may only run once. No data was changed.');
        }
    }
}
