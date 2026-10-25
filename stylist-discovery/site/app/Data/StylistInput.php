<?php

namespace App\Data;

use Illuminate\Support\Collection;

readonly class StylistInput
{
    /**
     * @param  string  $displayName
     * @param  string  $studioName
     * @param  string  $biography
     * @param  string  $address
     * @param  string  $cityCode
     * @param  int  $depositPercent
     * @param  Collection<int, int>  $specialtyIds
     * @return void
     */
    public function __construct(public string $displayName, public string $studioName, public string $biography, public string $address, public string $cityCode, public int $depositPercent, public Collection $specialtyIds) {}
}
