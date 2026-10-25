<?php

namespace App\Http\Controllers;

use App\Http\Requests\ServiceRequest;
use App\Models\Specialty;
use App\Services\StylistService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\View\View;

class ServiceController extends Controller
{
    /**
     * @param  Request  $request
     * @param  StylistService  $stylists
     * @return View
     */
    public function index(Request $request, StylistService $stylists): View
    {
        abort_unless(Validator::make($request->query(), ['page' => ['sometimes', 'integer', 'between:1,10000']])->passes(), 422, 'Choose a service page between 1 and 10,000.');
        $profile = $stylists->profile($request->user());

        return view('stylist.services', ['profile' => $profile, 'services' => $profile->services()->with('specialty')->orderBy('id')->paginate(config('demo.pagination'))->withQueryString()]);
    }

    /**
     * @param  Request  $request
     * @param  StylistService  $stylists
     * @param  ?int  $service
     * @return View
     */
    public function edit(Request $request, StylistService $stylists, ?int $service = null): View
    {
        $profile = $stylists->profile($request->user());
        $currentService = $service === null ? null : $profile->services()->with('specialty')->findOrFail($service);
        $specialties = Specialty::query()->where(function (Builder $specialties) use ($profile, $currentService): void {
            $specialties->where('enabled', true)->whereIn('id', $profile->specialties()->select('specialties.id'));
            if ($currentService !== null) {
                $specialties->orWhere('id', $currentService->specialty_id);
            }
        })->orderBy('name')->limit(6)->get();

        return view('stylist.service-edit', ['profile' => $profile, 'service' => $currentService, 'specialties' => $specialties, 'retainedSpecialty' => $currentService !== null && (! $currentService->specialty->enabled || ! $profile->specialties->contains('id', $currentService->specialty_id))]);
    }

    /**
     * @param  ServiceRequest  $request
     * @param  StylistService  $stylists
     * @param  ?int  $service
     * @return RedirectResponse
     */
    public function save(ServiceRequest $request, StylistService $stylists, ?int $service = null): RedirectResponse
    {
        $profile = $stylists->profile($request->user());
        $savedService = $stylists->saveService($request->user(), $service === null ? null : $profile->services()->findOrFail($service), $request->inputData());

        return redirect()->route('stylist.services.edit', $savedService->id)->withFragment('save-result')->with('status', 'Your service is saved. Review your menu or continue your studio setup.');
    }
}
