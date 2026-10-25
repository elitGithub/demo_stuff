<?php

namespace App\Http\Controllers;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Http\Requests\WorkspaceRequest;
use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\View\View;

class WorkspaceController extends Controller
{
    /** @param WorkspaceRequest $request
     * @param BookingService $bookings
     * @return View */
    public function index(WorkspaceRequest $request, BookingService $bookings): View
    {
        $actor = $request->user();
        abort_unless(in_array($actor->role, [AccountRole::Client, AccountRole::Stylist], true), 403);
        $now = CarbonImmutable::now('UTC');
        $status = $request->validated('status') !== null ? BookingStatus::from($request->validated('status')) : null;
        $date = $request->validated('date');
        $appointments = $bookings->forActor($actor, $status, $date, (int) $request->validated('page', 1), $now)->withQueryString();
        $counts = collect(BookingStatus::cases())->mapWithKeys(fn (BookingStatus $state): array => [$state->value => $bookings->countForActor($actor, $state, $now)]);

        return view('workspaces.'.$actor->role->value, ['appointments' => $appointments, 'counts' => $counts, 'status' => $status, 'date' => $date, 'now' => $now]);
    }
}
