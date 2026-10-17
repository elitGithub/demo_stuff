<?php

namespace App\Policies;

use App\Enums\JobStatus;
use App\Enums\ProviderStatus;
use App\Enums\QuoteStatus;
use App\Models\Quote;
use App\Models\User;

class ConversationPolicy
{
    public function view(User $actor, Quote $quote): bool
    {
        return $actor->id === $quote->provider_id || $actor->id === $quote->serviceRequest->customer_id;
    }

    public function send(User $actor, Quote $quote): bool
    {
        if (! $this->view($actor, $quote) || $quote->provider->profile?->status !== ProviderStatus::Approved) {
            return false;
        }
        $job = $quote->serviceRequest;

        return ($job->status === JobStatus::Open && $quote->status === QuoteStatus::Pending)
            || (in_array($job->status, [JobStatus::Booked, JobStatus::InProgress, JobStatus::AwaitingConfirmation], true)
                && $quote->status === QuoteStatus::Accepted && $job->accepted_quote_id === $quote->id);
    }
}
