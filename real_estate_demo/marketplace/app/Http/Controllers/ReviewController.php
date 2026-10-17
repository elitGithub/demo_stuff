<?php

namespace App\Http\Controllers;

use App\Actions\Reviews\SubmitReview;
use App\Http\Requests\StoreReviewRequest;
use App\Models\Review;
use App\Models\ServiceRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\View\View;

class ReviewController extends Controller
{
    public function create(ServiceRequest $serviceRequest, SubmitReview $review): View
    {
        Gate::authorize('create', [Review::class, $serviceRequest]);
        $review->ensureReady($serviceRequest);

        return view('reviews.form', ['job' => $serviceRequest->load('acceptedQuote.provider.profile')]);
    }

    public function store(StoreReviewRequest $request, ServiceRequest $serviceRequest, SubmitReview $review): RedirectResponse
    {
        $review->handle($request->user(), $serviceRequest, (int) $request->validated('rating'), $request->validated('body'));

        return to_route('requests.show', $serviceRequest)->with('status', 'Thank you. Your review is now on your professional’s profile.');
    }
}
