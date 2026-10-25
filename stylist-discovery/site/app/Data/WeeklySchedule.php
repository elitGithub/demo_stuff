<?php

namespace App\Data;

use Illuminate\Support\Collection;

readonly class WeeklySchedule
{
    /** @param Collection<int, WeeklyInterval> $intervals */
    public function __construct(public Collection $intervals) {}
}
