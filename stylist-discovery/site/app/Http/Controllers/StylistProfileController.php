<?php

namespace App\Http\Controllers;

use App\Enums\ProfileStatus;
use App\Http\Requests\StylistProfileRequest;
use App\Http\Requests\SubmitProfileRequest;
use App\Models\Specialty;
use App\Services\StylistService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class StylistProfileController extends Controller
{
    /**
     * @param  Request  $request
     * @param  StylistService  $stylists
     * @return View
     */
    public function onboarding(Request $request, StylistService $stylists): View
    {
        $profile = $stylists->profile($request->user());

        return view('stylist.onboarding', ['profile' => $profile, 'profileComplete' => $stylists->profileComplete($profile), 'servicesComplete' => $profile->services()->eligible()->whereIn('specialty_id', $profile->specialties()->select('specialties.id'))->exists(), 'hoursComplete' => $profile->workingHours()->exists()]);
    }

    /**
     * @param  Request  $request
     * @param  StylistService  $stylists
     * @return View
     */
    public function edit(Request $request, StylistService $stylists): View
    {
        return view('stylist.profile', ['profile' => $stylists->profile($request->user()), 'specialties' => Specialty::query()->where('enabled', true)->orderBy('name')->limit(6)->get()]);
    }

    /**
     * @param  StylistProfileRequest  $request
     * @param  StylistService  $stylists
     * @return RedirectResponse
     */
    public function update(StylistProfileRequest $request, StylistService $stylists): RedirectResponse
    {
        $stylists->saveProfile($request->user(), $request->inputData());

        return redirect()->route('stylist.profile.edit')->withFragment('save-result')->with('status', 'Your profile and deposit settings are saved. Continue with your services.');
    }

    /**
     * @param  SubmitProfileRequest  $request
     * @param  StylistService  $stylists
     * @return RedirectResponse
     */
    public function submit(SubmitProfileRequest $request, StylistService $stylists): RedirectResponse
    {
        $profile = $stylists->submit($request->user());

        return redirect()->route('stylist.onboarding')->with('status', $profile->status === ProfileStatus::Published ? 'Your profile is already published.' : 'Profile submitted. Try the demo admin perspective to review and publish it.');
    }
}
