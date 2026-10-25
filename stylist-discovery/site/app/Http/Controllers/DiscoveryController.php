<?php

namespace App\Http\Controllers;

use App\Http\Requests\DiscoveryRequest;
use App\Services\DiscoveryService;
use Illuminate\View\View;

class DiscoveryController extends Controller
{
    /**
     * @param  DiscoveryRequest  $request
     * @param  DiscoveryService  $discovery
     * @return View
     */
    public function index(DiscoveryRequest $request, DiscoveryService $discovery): View
    {
        $catalogue = $discovery->catalogue();

        return view('discovery.index', [
            'profiles' => $discovery->search($request->inputData()),
            'filter' => $request->inputData(),
            'values' => $request->filterValues(),
            'specialties' => $catalogue->specialties,
            'demoStylist' => $catalogue->demoStylist,
        ]);
    }

    /**
     * @param  DiscoveryRequest  $request
     * @param  DiscoveryService  $discovery
     * @param  int  $profile
     * @return View
     */
    public function show(DiscoveryRequest $request, DiscoveryService $discovery, int $profile): View
    {
        $catalogue = $discovery->stylistCatalogue($profile, (int) ($request->validated('services_page') ?? 1), (int) ($request->validated('portfolio_page') ?? 1));

        return view('stylists.show', [
            'profile' => $catalogue->profile,
            'services' => $catalogue->services,
            'portfolio' => $catalogue->portfolio,
        ]);
    }
}
