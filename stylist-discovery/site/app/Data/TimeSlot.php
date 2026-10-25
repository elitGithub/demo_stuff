<?php

namespace App\Data;

use Carbon\CarbonImmutable;

readonly class TimeSlot
{
    /**
     * @param  CarbonImmutable  $startsAt
     * @param  CarbonImmutable  $endsAt
     * @param  string  $timezone
     */
    public function __construct(public CarbonImmutable $startsAt, public CarbonImmutable $endsAt, public string $timezone) {}
}
