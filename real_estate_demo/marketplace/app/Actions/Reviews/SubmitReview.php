<?php

namespace App\Actions\Reviews;

use App\Enums\JobStatus;
use App\Enums\QuoteStatus;
use App\Exceptions\WorkflowConflict;
use App\Models\Review;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class SubmitReview
{
    public function handle(User $actor, ServiceRequest $request, int $rating, string $body): Review
    {
        return DB::transaction(function () use ($actor, $request, $rating, $body): Review {
            $job = ServiceRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('create', [Review::class, $job]);
            $this->ensureReady($job);
            $review = $job->review()->create([
                'customer_id' => $job->customer_id, 'provider_id' => $job->acceptedQuote->provider_id,
                'rating' => $rating, 'body' => $body,
            ]);
            $job->acceptedQuote->provider->notify(new MarketplaceNotification(
                'A customer left a review', 'You received a '.$rating.'-star review for '.$job->title.'.',
                'requests.show', ['serviceRequest' => $job->id],
            ));

            return $review;
        }, 3);
    }

    public function ensureReady(ServiceRequest $job): void
    {
        if ($job->status !== JobStatus::Completed
            || $job->acceptedQuote?->status !== QuoteStatus::Accepted
            || $job->acceptedQuote->service_request_id !== $job->id) {
            throw new WorkflowConflict('You can leave a review after confirming the job is complete.');
        }
        if ($job->review()->exists()) {
            throw new WorkflowConflict('You have already reviewed this job.');
        }
    }
}
