<?php

namespace App\Support;

use App\Enums\CasefileMode;
use App\Exceptions\ModeNotConfigured;

final class ModeGuard
{
    /**
     * @param  CasefileMode  $mode
     * @return void
     *
     * @throws ModeNotConfigured
     */
    public static function assertRunnable(CasefileMode $mode): void
    {
        match ($mode) {
            CasefileMode::Local => null,
            CasefileMode::Demo => config('database.default') === 'sqlite'
                ? null
                : throw new ModeNotConfigured('CASEFILE_MODE=demo requires the sqlite connection as the default.'),
            CasefileMode::Production => throw new ModeNotConfigured(
                'CASEFILE_MODE=production needs a real sign-in provider and mailbox connector; none is configured in this build.'
            ),
        };
    }
}
