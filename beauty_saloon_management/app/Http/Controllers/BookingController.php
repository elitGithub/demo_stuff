<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\Service;
use App\Models\Stylist;
use App\Services\BookingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class BookingController extends Controller
{
    public function home(): View
    {
        return view('public.home', ['services' => Service::where('active', true)->get(), 'stylists' => Stylist::where('active', true)->get()]);
    }

    public function create(Request $request): View
    {
        $staff = $request->routeIs('appointments.create');
        $repeat = $staff && $request->filled('repeat') ? Appointment::with(['client', 'items'])->findOrFail($request->integer('repeat')) : null;
        $client = $repeat?->client ?? ($staff && $request->filled('client') ? Client::findOrFail($request->integer('client')) : null);
        $selectedServices = array_map('intval', $request->old('service_ids', $repeat?->items->pluck('service_id')->all() ?? $client?->preferred_services ?? [$request->integer('service', Service::where('active', true)->value('id') ?? 0)]));
        $stylists = Stylist::with('services')->where('active', true)->get();
        $selectedStylist = $request->old('stylist_id', $repeat?->stylist_id ?? $client?->preferred_stylist_id ?? $request->input('stylist'));
        $unavailableStylist = $selectedStylist && ! $stylists->contains('id', $selectedStylist);
        if (! $selectedStylist && ! $unavailableStylist) {
            $selectedStylist = $stylists->first(fn ($stylist) => ! array_diff($selectedServices, $stylist->services->pluck('id')->all()))?->id;
        }

        return view('public.book', [
            'staff' => $staff, 'client' => $client, 'repeat' => $repeat, 'clients' => $staff ? Client::orderBy('name')->get() : collect(),
            'services' => Service::where('active', true)->orWhereIn('id', $selectedServices)->get(),
            'stylists' => $stylists, 'selectedStylist' => $selectedStylist, 'selectedServices' => $selectedServices, 'unavailableStylist' => $unavailableStylist,
        ]);
    }

    public function availability(Request $request, BookingService $booking): JsonResponse
    {
        $data = $request->validate(['stylist_id' => 'required|integer|exists:stylists,id', 'service_ids' => 'required|array|max:10', 'service_ids.*' => 'integer|distinct', 'date' => 'required|date_format:Y-m-d|after_or_equal:'.now(config('studio.timezone'))->format('Y-m-d').'|before_or_equal:'.now()->addMonths(6)->format('Y-m-d')]);

        return response()->json(['slots' => $booking->slots(Stylist::findOrFail($data['stylist_id']), $data['service_ids'], $data['date'])]);
    }

    public function store(Request $request, BookingService $booking): RedirectResponse
    {
        $staff = $request->routeIs('appointments.store');
        $data = $request->only(['name', 'email', 'phone', 'stylist_id', 'service_ids', 'date', 'time', 'channels', 'notes']);
        if ($staff) {
            $data['client_id'] = $request->input('client_id');
        } else {
            $request->validate(['name' => 'required|string|max:120', 'email' => 'required|email|max:200', 'phone' => 'required|string|max:30']);
        }
        $appointment = $booking->book($data);

        return $staff ? redirect()->route('appointments.show', $appointment)->with('success', 'Appointment booked. The client’s reminder is ready.') : redirect()->route('booking.confirmed', $appointment->reference);
    }

    public function confirmation(string $reference): View
    {
        $appointment = Appointment::with(['stylist', 'items'])->where('reference', $reference)->firstOrFail();

        return view('public.confirmation', compact('appointment'));
    }

    public function show(Appointment $appointment): View
    {
        return view('appointments.show', ['appointment' => $appointment->load(['client', 'stylist', 'items', 'invoice', 'reminders'])]);
    }

    public function status(Request $request, Appointment $appointment, BookingService $booking): RedirectResponse
    {
        $data = $request->validate(['status' => 'required|in:confirmed,completed,cancelled,no_show']);
        $booking->transition($appointment, $data['status']);

        return back()->with('success', 'Appointment updated.');
    }

    public function reschedule(Request $request, Appointment $appointment, BookingService $booking): RedirectResponse
    {
        $data = $request->validate(['date' => 'required|date_format:Y-m-d', 'time' => 'required|date_format:H:i']);
        $booking->reschedule($appointment, $data['date'], $data['time']);

        return back()->with('success', 'Appointment rescheduled and reminders updated.');
    }
}
