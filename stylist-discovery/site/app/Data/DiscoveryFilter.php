<?php

namespace App\Data;

use App\Enums\DiscoverySort;

readonly class DiscoveryFilter
{
    /**
     * @param  ?string  $search
     * @param  ?string  $countryCode
     * @param  ?string  $cityCode
     * @param  ?int  $specialtyId
     * @param  ?int  $minimumCents
     * @param  ?int  $maximumCents
     * @param  DiscoverySort  $sort
     * @param  int  $page
     * @return void
     */
    public function __construct(
        public ?string $search,
        public ?string $countryCode,
        public ?string $cityCode,
        public ?int $specialtyId,
        public ?int $minimumCents,
        public ?int $maximumCents,
        public DiscoverySort $sort,
        public int $page,
    ) {}
}
