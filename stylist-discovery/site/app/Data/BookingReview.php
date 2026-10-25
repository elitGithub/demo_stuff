<?php

namespace App\Data;

use App\Models\Service;
use App\Models\StylistProfile;
use Carbon\CarbonImmutable;

readonly class BookingReview
{
    /**
     * @param  Service  $service
     * @param  StylistProfile  $profile
     * @param  CarbonImmutable  $startsAt
     * @param  string  $requestKey
     * @param  int  $depositCents
     */
    public function __construct(public Service $service, public StylistProfile $profile, public CarbonImmutable $startsAt, public string $requestKey, public int $depositCents) {}
}
