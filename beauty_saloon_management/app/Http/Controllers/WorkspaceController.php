<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\FollowUp;
use App\Models\Invoice;
use App\Models\Reminder;
use App\Models\Stylist;
use App\Services\ReminderService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class WorkspaceController extends Controller
{
    public function dashboard(): View
    {
        $today = CarbonImmutable::now(config('studio.timezone'))->startOfDay();
        $appointments = Appointment::with(['client', 'stylist', 'items'])->whereBetween('starts_at', [$today->utc(), $today->endOfDay()->utc()])->orderBy('starts_at')->get();

        return view('workspace.dashboard', [
            'today' => $today, 'appointments' => $appointments,
            'revenue' => auth()->user()->isManager() ? Invoice::where('status', 'paid')->where('paid_at', '>=', $today->startOfMonth()->utc())->where('currency', config('studio.currency'))->sum('total') : null,
            'clientCount' => Client::count(),
            'followUpCount' => FollowUp::whereNull('completed_at')->count(),
            'followUps' => FollowUp::with('client')->whereNull('completed_at')->orderBy('due_date')->limit(5)->get(),
            'recentClients' => Client::withCount('appointments')->latest()->limit(4)->get(),
            'upcoming' => Appointment::with(['client', 'stylist', 'items'])->whereIn('status', ['booked', 'confirmed'])->where('starts_at', '>', $today->endOfDay()->utc())->orderBy('starts_at')->limit(4)->get(),
        ]);
    }

    public function schedule(Request $request): View
    {
        $request->validate(['date' => 'nullable|date_format:Y-m-d', 'stylist' => 'nullable|integer|exists:stylists,id']);
        $day = CarbonImmutable::parse($request->input('date', now(config('studio.timezone'))->format('Y-m-d')), config('studio.timezone'));
        $appointments = Appointment::with(['client', 'stylist', 'items'])->whereBetween('starts_at', [$day->startOfDay()->utc(), $day->endOfDay()->utc()])->when($request->filled('stylist'), fn ($query) => $query->where('stylist_id', $request->integer('stylist')))->orderBy('starts_at')->get();

        $stylists = Stylist::all();
        $startHour = min(8, (int) substr($stylists->min('start_time') ?? '08:00', 0, 2), $appointments->min(fn ($visit) => $visit->localStart()->hour) ?? 8);
        $endHour = max(20, (int) substr($stylists->max('end_time') ?? '20:00', 0, 2) + 1, $appointments->max(fn ($visit) => $visit->localEnd()->hour + 1) ?? 20);

        return view('appointments.index', compact('day', 'appointments', 'stylists', 'startHour', 'endHour'));
    }

    public function reminders(): View
    {
        return view('workspace.reminders', ['reminders' => Reminder::with('appointment.client')->latest()->paginate(20), 'pending' => Reminder::where('status', 'pending')->count(), 'simulated' => Reminder::where('status', 'simulated')->count()]);
    }

    public function process(ReminderService $reminders): RedirectResponse
    {
        $count = $reminders->processDue();

        return back()->with('success', "$count due reminders previewed. No messages were sent.");
    }

    public function followUp(FollowUp $followUp): RedirectResponse
    {
        $followUp->update(['completed_at' => now()]);

        return back()->with('success', 'Follow-up completed.');
    }

    public function settings(): View
    {
        return view('workspace.settings');
    }
}
