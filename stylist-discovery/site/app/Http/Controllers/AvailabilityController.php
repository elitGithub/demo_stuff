<?php

namespace App\Http\Controllers;

use App\Http\Requests\SlotRequest;
use App\Http\Requests\SubmitProfileRequest;
use App\Http\Requests\TimeOffRequest;
use App\Http\Requests\WeeklyScheduleRequest;
use App\Models\Service;
use App\Services\AvailabilityService;
use App\Services\StylistService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class AvailabilityController extends Controller
{
    /**
     * @param  Request  $request
     * @param  StylistService  $stylists
     * @return View
     */
    public function edit(Request $request, StylistService $stylists): View
    {
        if ($request->isMethod('get')) {
            $request->validate(['page' => ['sometimes', 'integer', 'between:1,10000']]);
        }
        $profile = $stylists->profile($request->user());

        return view('stylist.availability', ['profile' => $profile, 'hours' => $profile->workingHours()->orderBy('weekday')->get()->keyBy('weekday'), 'timeOff' => $profile->timeOff()->orderBy('starts_at')->orderBy('id')->paginate(config('demo.pagination'))->withQueryString()]);
    }

    /**
     * @param  WeeklyScheduleRequest  $request
     * @param  AvailabilityService  $availability
     * @return RedirectResponse
     */
    public function update(WeeklyScheduleRequest $request, AvailabilityService $availability): RedirectResponse
    {
        $availability->saveWeekly($request->user(), $request->inputData());

        return redirect()->route('stylist.availability.edit')->withFragment('save-result')->with('status', 'Your weekly hours are updated. Review your schedule or return to your studio.');
    }

    /**
     * @param  TimeOffRequest  $request
     * @param  AvailabilityService  $availability
     * @return RedirectResponse
     */
    public function storeTimeOff(TimeOffRequest $request, AvailabilityService $availability): RedirectResponse
    {
        $availability->addTimeOff($request->user(), $request->inputData());

        return redirect()->route('stylist.availability.edit')->withFragment('time-off')->with('availability_target', 'time-off')->with('status', 'Your time off is saved. Clients will see only available appointment times.');
    }

    /**
     * @param  SubmitProfileRequest  $request
     * @param  AvailabilityService  $availability
     * @param  StylistService  $stylists
     * @param  int  $timeOff
     * @return RedirectResponse
     */
    public function destroyTimeOff(SubmitProfileRequest $request, AvailabilityService $availability, StylistService $stylists, int $timeOff): RedirectResponse
    {
        $interval = $stylists->profile($request->user())->timeOff()->findOrFail($timeOff);
        $availability->removeTimeOff($request->user(), $interval);

        return redirect()->route('stylist.availability.edit')->withFragment('time-off')->with('availability_target', 'time-off')->with('status', 'Time off removed. Weekly hours and other time off still apply.');
    }

    /**
     * @param  SlotRequest  $request
     * @param  AvailabilityService  $availability
     * @return View
     */
    public function slots(SlotRequest $request, AvailabilityService $availability): View
    {
        $service = Service::query()->eligible()->whereHas('profile', fn ($profiles) => $profiles->discoverable())->with('profile')->findOrFail((int) $request->validated('service'));
        $now = CarbonImmutable::now('UTC');
        $date = $request->validated('date') ?? $now->setTimezone($service->profile->timezone)->addDay()->toDateString();

        return view('bookings.slots', ['service' => $service, 'profile' => $service->profile, 'date' => $date, 'minimumDate' => $now->setTimezone($service->profile->timezone)->toDateString(), 'maximumDate' => $now->addDays(config('demo.booking.horizon_days'))->setTimezone($service->profile->timezone)->toDateString(), 'slots' => $availability->slots($service, $date, $now)]);
    }
}
