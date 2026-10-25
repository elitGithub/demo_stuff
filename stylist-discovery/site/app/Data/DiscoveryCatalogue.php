<?php

namespace App\Data;

use App\Models\Specialty;
use App\Models\StylistProfile;
use Illuminate\Database\Eloquent\Collection;

readonly class DiscoveryCatalogue
{
    /**
     * @param  Collection<int, Specialty>  $specialties
     * @param  ?StylistProfile  $demoStylist
     * @return void
     */
    public function __construct(public Collection $specialties, public ?StylistProfile $demoStylist) {}
}
