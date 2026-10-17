<?php

namespace App\Http\Controllers;

use App\Enums\JobStatus;
use App\Enums\QuoteStatus;
use App\Enums\Role;
use App\Models\Payment;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Queries\ProviderOpportunities;
use Illuminate\Http\Request;
use Illuminate\View\View;

class DashboardController extends Controller
{
    public function __invoke(Request $request, ProviderOpportunities $opportunities): View
    {
        $user = $request->user();
        $active = [JobStatus::Booked, JobStatus::InProgress, JobStatus::AwaitingConfirmation];

        if ($user->role === Role::Customer) {
            return view('customer.dashboard', [
                'jobs' => $user->requests()->with('category')->withCount('quotes')->latest()->paginate(8),
                'stats' => [
                    'Open requests' => $user->requests()->where('status', JobStatus::Open)->count(),
                    'New proposals' => Quote::where('status', QuoteStatus::Pending)
                        ->whereHas('serviceRequest', fn ($query) => $query->where('customer_id', $user->id)->where('status', JobStatus::Open))->count(),
                    'In good hands' => $user->requests()->whereIn('status', $active)->count(),
                    'All done' => $user->requests()->where('status', JobStatus::Completed)->count(),
                ],
            ]);
        }

        if ($user->role === Role::Provider) {
            $bookings = ServiceRequest::whereHas('acceptedQuote', fn ($query) => $query->where('provider_id', $user->id));

            return view('professional.dashboard', [
                'jobs' => (clone $bookings)->with('category')->latest()->paginate(8),
                'simulatedTotal' => (int) Payment::where('status', 'simulated_paid')->whereHas('serviceRequest.acceptedQuote', fn ($query) => $query->where('provider_id', $user->id))->sum('amount_cents'),
                'quotes' => $user->quotes()->with('serviceRequest.category')->latest()->limit(5)->get(),
                'stats' => [
                    'Opportunities' => $opportunities->forUser($user)->count(),
                    'Proposals sent' => $user->quotes()->where('status', QuoteStatus::Pending)->count(),
                    'Active jobs' => (clone $bookings)->whereIn('status', $active)->count(),
                    'Completed' => (clone $bookings)->where('status', JobStatus::Completed)->count(),
                ],
            ]);
        }

        return app(Admin\DashboardController::class)();
    }
}
