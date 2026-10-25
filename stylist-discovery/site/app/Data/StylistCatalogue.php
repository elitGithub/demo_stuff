<?php

namespace App\Data;

use App\Models\PortfolioImage;
use App\Models\Service;
use App\Models\StylistProfile;
use Illuminate\Pagination\LengthAwarePaginator;

readonly class StylistCatalogue
{
    /**
     * @param  StylistProfile  $profile
     * @param  LengthAwarePaginator<Service>  $services
     * @param  LengthAwarePaginator<PortfolioImage>  $portfolio
     * @return void
     */
    public function __construct(public StylistProfile $profile, public LengthAwarePaginator $services, public LengthAwarePaginator $portfolio) {}
}
