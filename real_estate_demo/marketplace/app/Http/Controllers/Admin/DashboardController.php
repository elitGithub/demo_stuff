<?php

namespace App\Http\Controllers\Admin;

use App\Enums\JobStatus;
use App\Enums\ProviderStatus;
use App\Http\Controllers\Controller;
use App\Models\Category;
use App\Models\Payment;
use App\Models\ProviderProfile;
use App\Models\ServiceRequest;
use Illuminate\View\View;

class DashboardController extends Controller
{
    public function __invoke(): View
    {
        return view('admin.dashboard', [
            'stats' => [
                'Requests' => ServiceRequest::count(),
                'Pending professionals' => ProviderProfile::where('status', ProviderStatus::Pending)->count(),
                'Active services' => Category::where('is_active', true)->count(),
                'Completed jobs' => ServiceRequest::where('status', JobStatus::Completed)->count(),
            ],
            'simulatedTotal' => (int) Payment::where('status', 'simulated_paid')->sum('amount_cents'),
            'states' => ServiceRequest::query()->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status'),
            'jobs' => ServiceRequest::with('category', 'customer')->latest()->limit(5)->get(),
            'pending' => ProviderProfile::with('user', 'categories')->where('status', ProviderStatus::Pending)->oldest()->limit(5)->get(),
        ]);
    }
}
