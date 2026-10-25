<?php

namespace App\Data;

readonly class WeeklyInterval
{
    /**
     * @param  int  $weekday
     * @param  string  $opensAt
     * @param  string  $closesAt
     */
    public function __construct(public int $weekday, public string $opensAt, public string $closesAt) {}
}
