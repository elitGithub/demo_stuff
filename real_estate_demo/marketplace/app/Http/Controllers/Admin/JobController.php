<?php

namespace App\Http\Controllers\Admin;

use App\Enums\JobStatus;
use App\Http\Controllers\Controller;
use App\Models\ServiceRequest;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\View\View;

class JobController extends Controller
{
    public function index(Request $request): View
    {
        $filters = $request->validate(['status' => ['nullable', Rule::enum(JobStatus::class)], 'q' => ['nullable', 'string', 'max:100']]);
        $query = ServiceRequest::with('category', 'customer', 'acceptedQuote.provider.profile')->withCount('quotes')->latest();
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['q'])) {
            $query->where('title', 'like', '%'.$filters['q'].'%');
        }

        return view('admin.jobs', ['jobs' => $query->paginate(15)->withQueryString()]);
    }
}
