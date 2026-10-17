<?php

namespace App\Support;

use Carbon\CarbonImmutable;

final class DisplayDate
{
    /**
     * @param  CarbonImmutable  $moment
     * @return string
     */
    public static function date(CarbonImmutable $moment): string
    {
        return self::local($moment)->format('M j, Y');
    }

    /**
     * @param  CarbonImmutable  $moment
     * @return string
     */
    public static function time(CarbonImmutable $moment): string
    {
        return self::local($moment)->format('g:i a');
    }

    /**
     * @param  CarbonImmutable  $moment
     * @return string
     */
    public static function day(CarbonImmutable $moment): string
    {
        $local = self::local($moment);

        return match (true) {
            $local->isToday() => 'Today',
            $local->isYesterday() => 'Yesterday',
            default => $local->format('M j'),
        };
    }

    /**
     * @param  CarbonImmutable  $moment
     * @return string
     */
    public static function iso(CarbonImmutable $moment): string
    {
        return self::local($moment)->toIso8601String();
    }

    /**
     * @param  CarbonImmutable  $moment
     * @return CarbonImmutable
     */
    private static function local(CarbonImmutable $moment): CarbonImmutable
    {
        return $moment->setTimezone(config('app.timezone'));
    }
}
