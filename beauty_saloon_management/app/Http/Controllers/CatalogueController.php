<?php

namespace App\Http\Controllers;

use App\Models\Service;
use App\Models\Stylist;
use App\Models\TimeOff;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class CatalogueController extends Controller
{
    public function services(): View
    {
        return view('catalogue.services', ['services' => Service::orderBy('category')->get(), 'stylists' => Stylist::where('active', true)->get()]);
    }

    public function saveService(Request $request, ?Service $service = null): RedirectResponse
    {
        $data = $request->validate(['name' => 'required|string|max:120', 'category' => 'required|string|max:60', 'description' => 'nullable|string|max:500', 'price_amount' => 'required|numeric|min:0|max:10000|decimal:0,2', 'duration' => 'required|integer|min:15|max:480', 'active' => 'nullable|boolean', 'stylist_ids' => 'nullable|array', 'stylist_ids.*' => 'integer|exists:stylists,id']);
        $data['price'] = (int) round((float) $data['price_amount'] * 100);
        $data['active'] = $request->boolean('active');
        $ids = $data['stylist_ids'] ?? [];
        unset($data['price_amount'], $data['stylist_ids']);
        DB::transaction(function () use ($service, $data, $ids) {
            $service ??= new Service;
            $service->fill($data)->save();
            $service->stylists()->sync($ids);
        });

        return back()->with('success', 'Service saved. Existing appointments keep their original prices.');
    }

    public function team(): View
    {
        return view('catalogue.team', ['stylists' => Stylist::with(['services', 'timeOffs' => fn ($query) => $query->where('ends_at', '>', now())])->get(), 'services' => Service::where('active', true)->get()]);
    }

    public function saveStylist(Request $request, ?Stylist $stylist = null): RedirectResponse
    {
        $data = $request->validate(['name' => 'required|string|max:120', 'title' => 'required|string|max:100', 'bio' => 'nullable|string|max:600', 'commission_rate' => 'nullable|integer|between:0,100', 'working_days' => 'required|array|min:1', 'working_days.*' => 'integer|between:0,6|distinct', 'start_time' => 'required|date_format:H:i', 'end_time' => 'required|date_format:H:i|after:start_time', 'active' => 'nullable|boolean', 'service_ids' => 'nullable|array', 'service_ids.*' => 'integer|exists:services,id']);
        $ids = $data['service_ids'] ?? [];
        unset($data['service_ids']);
        $data['working_days'] = array_map('intval', $data['working_days']);
        $data['active'] = $request->boolean('active');
        DB::transaction(function () use ($stylist, $data, $ids) {
            if ($stylist?->exists) {
                Stylist::whereKey($stylist->id)->increment('lock_version');
                foreach ($stylist->appointments()->whereIn('status', ['booked', 'confirmed'])->where('starts_at', '>', now())->get() as $appointment) {
                    if (! in_array($appointment->localStart()->dayOfWeek, $data['working_days'], true) || $appointment->localStart()->format('H:i') < $data['start_time'] || $appointment->localEnd()->format('H:i') > $data['end_time']) {
                        throw ValidationException::withMessages(['working_days' => 'These hours conflict with an upcoming appointment. Reschedule it first.']);
                    }
                }
            }
            $stylist ??= new Stylist;
            $stylist->fill($data)->save();
            $stylist->services()->sync($ids);
        }, 5);

        return back()->with('success', 'Team member and availability saved.');
    }

    public function timeOff(Request $request, Stylist $stylist): RedirectResponse
    {
        $data = $request->validate(['date' => 'required|date_format:Y-m-d', 'start_time' => 'required|date_format:H:i', 'end_time' => 'required|date_format:H:i|after:start_time', 'reason' => 'nullable|string|max:120']);
        $start = CarbonImmutable::parse($data['date'].' '.$data['start_time'], config('studio.timezone'))->utc();
        $end = CarbonImmutable::parse($data['date'].' '.$data['end_time'], config('studio.timezone'))->utc();
        DB::transaction(function () use ($stylist, $start, $end, $data) {
            Stylist::whereKey($stylist->id)->increment('lock_version');
            if ($stylist->appointments()->whereIn('status', ['booked', 'confirmed'])->where('starts_at', '<', $end)->where('ends_at', '>', $start)->exists()) {
                throw ValidationException::withMessages(['date' => 'Time off overlaps a booked appointment. Reschedule that visit first.']);
            }
            $stylist->timeOffs()->create(['starts_at' => $start, 'ends_at' => $end, 'reason' => $data['reason'] ?? null]);
        }, 5);

        return back()->with('success', 'Time blocked on the calendar.');
    }

    public function removeTimeOff(Stylist $stylist, TimeOff $timeOff): RedirectResponse
    {
        abort_unless($timeOff->stylist_id === $stylist->id, 404);
        DB::transaction(function () use ($stylist, $timeOff) {
            Stylist::whereKey($stylist->id)->increment('lock_version');
            $timeOff->delete();
        }, 5);

        return back()->with('success', 'Time off removed. This time is available for bookings again.');
    }
}
