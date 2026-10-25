<?php

namespace App\Data;

readonly class TimeOffInput
{
    /**
     * @param  string  $startsLocal
     * @param  string  $endsLocal
     */
    public function __construct(public string $startsLocal, public string $endsLocal) {}
}
