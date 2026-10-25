<?php

namespace App\Data;

readonly class ServiceInput
{
    /**
     * @param  string  $name
     * @param  int  $specialtyId
     * @param  int  $priceCents
     * @param  int  $durationMinutes
     * @param  bool  $active
     * @return void
     */
    public function __construct(public string $name, public int $specialtyId, public int $priceCents, public int $durationMinutes, public bool $active) {}
}
