<?php

namespace App\Http\Controllers;

use App\Actions\Requests\CreateServiceRequest;
use App\Actions\Requests\UpdateServiceRequest;
use App\Enums\JobStatus;
use App\Enums\Role;
use App\Http\Requests\StoreServiceRequestRequest;
use App\Http\Requests\UpdateServiceRequestRequest;
use App\Models\Category;
use App\Models\ServiceRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\View\View;

class ServiceRequestController extends Controller
{
    public function create(): View
    {
        Gate::authorize('create', ServiceRequest::class);

        return view('requests.create', ['categories' => Category::where('is_active', true)->orderBy('name')->get()]);
    }

    public function store(StoreServiceRequestRequest $request, CreateServiceRequest $create): RedirectResponse
    {
        $job = $create->handle($request->user(), $request->validated(), $request->file('photos', []));

        return to_route('requests.show', $job)->with('status', 'Your request is live. Let the right help find you.');
    }

    public function show(Request $request, ServiceRequest $serviceRequest): View
    {
        Gate::authorize('view', $serviceRequest);
        $serviceRequest->load(['category', 'customer', 'photos', 'events', 'acceptedQuote.provider.profile', 'payment', 'review']);
        $allQuotes = $request->user()->id === $serviceRequest->customer_id || $request->user()->role === Role::Admin;
        $quotes = $serviceRequest->quotes()->with(['provider.profile', 'provider' => fn ($query) => $query->withAvg('receivedReviews', 'rating')->withCount('receivedReviews')])
            ->when(! $allQuotes, fn ($query) => $query->where('provider_id', $request->user()->id))
            ->latest()->get();

        return view('requests.show', [
            'job' => $serviceRequest, 'quotes' => $quotes,
            'showPrivate' => Gate::allows('viewPrivateDetails', $serviceRequest),
        ]);
    }

    public function edit(ServiceRequest $serviceRequest): View
    {
        Gate::authorize('update', $serviceRequest);
        abort_unless($serviceRequest->status === JobStatus::Open && ! $serviceRequest->quotes()->exists(),
            409, 'This request can no longer be edited.');

        return view('requests.edit', [
            'job' => $serviceRequest, 'categories' => Category::where('is_active', true)->orderBy('name')->get(),
        ]);
    }

    public function update(UpdateServiceRequestRequest $request, ServiceRequest $serviceRequest, UpdateServiceRequest $update): RedirectResponse
    {
        $job = $update->handle($request->user(), $serviceRequest, $request->validated());

        return to_route('requests.show', $job)->with('status', 'Your request has been updated.');
    }
}
