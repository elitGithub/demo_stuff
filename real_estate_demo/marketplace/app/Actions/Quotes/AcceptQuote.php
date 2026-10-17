<?php

namespace App\Actions\Quotes;

use App\Enums\JobStatus;
use App\Enums\ProviderStatus;
use App\Enums\QuoteStatus;
use App\Exceptions\WorkflowConflict;
use App\Models\ProviderProfile;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use App\Queries\MatchingProviders;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class AcceptQuote
{
    public function __construct(private MatchingProviders $matching) {}

    public function handle(User $actor, Quote $quote, int $expectedVersion): ServiceRequest
    {
        return DB::transaction(function () use ($actor, $quote, $expectedVersion): ServiceRequest {
            $job = ServiceRequest::whereKey($quote->service_request_id)->lockForUpdate()->firstOrFail();
            $current = Quote::whereKey($quote->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('accept', $current);

            if ($current->version !== $expectedVersion) {
                throw new WorkflowConflict('This proposal changed. Review its latest details.');
            }
            if ($job->accepted_quote_id === $current->id && $current->status === QuoteStatus::Accepted) {
                return $job;
            }
            if ($job->status !== JobStatus::Open || $current->status !== QuoteStatus::Pending) {
                throw new WorkflowConflict('This request already has a decision. Refresh to continue.');
            }

            $profile = ProviderProfile::where('user_id', $current->provider_id)->lockForUpdate()->first();
            if ($profile?->status !== ProviderStatus::Approved
                || ! $this->matching->forRequest($job)->whereKey($current->provider_id)->exists()) {
                throw new WorkflowConflict('This professional is currently unavailable for your request.');
            }

            $updated = ServiceRequest::whereKey($job->id)->where('status', JobStatus::Open)
                ->whereNull('accepted_quote_id')->update([
                    'status' => JobStatus::Booked, 'accepted_quote_id' => $current->id,
                ]);
            if ($updated !== 1) {
                throw new WorkflowConflict('Another decision was saved. Refresh to continue.');
            }

            $current->update(['status' => QuoteStatus::Accepted]);
            $declined = $job->quotes()->where('id', '!=', $current->id)->where('status', QuoteStatus::Pending)->with('provider')->get();
            foreach ($declined as $other) {
                $other->update(['status' => QuoteStatus::Declined]);
                $other->provider->notify(new MarketplaceNotification(
                    'An update on your proposal', 'The customer has chosen a professional for '.$job->title.'.',
                    'requests.show', ['serviceRequest' => $job->id],
                ));
            }
            $job->events()->create([
                'actor_id' => $actor->id, 'type' => 'booked', 'description' => 'A professional was hired.',
            ]);
            $current->provider->notify(new MarketplaceNotification(
                'You were hired', $job->title, 'requests.show', ['serviceRequest' => $job->id],
            ));

            return $job->refresh();
        }, 3);
    }
}
