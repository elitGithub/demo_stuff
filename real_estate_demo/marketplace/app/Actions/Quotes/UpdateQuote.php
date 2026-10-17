<?php

namespace App\Actions\Quotes;

use App\Enums\JobStatus;
use App\Enums\QuoteStatus;
use App\Exceptions\WorkflowConflict;
use App\Models\ProviderProfile;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use App\Queries\MatchingProviders;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class UpdateQuote
{
    public function __construct(private MatchingProviders $matching) {}

    public function handle(User $actor, Quote $quote, array $validated): Quote
    {
        return DB::transaction(function () use ($actor, $quote, $validated): Quote {
            $job = ServiceRequest::whereKey($quote->service_request_id)->lockForUpdate()->firstOrFail();
            $current = Quote::whereKey($quote->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('update', $current);
            ProviderProfile::where('user_id', $actor->id)->lockForUpdate()->first();
            abort_unless($this->matching->forRequest($job)->whereKey($actor->id)->exists(), 403);

            if ($job->status !== JobStatus::Open || $current->status !== QuoteStatus::Pending
                || $current->version !== (int) $validated['version']) {
                throw new WorkflowConflict('This proposal changed or has already been decided. Refresh before editing.');
            }

            $current->update([
                'amount_cents' => Money::parse($validated['amount'], 100),
                'available_date' => $validated['available_date'], 'scope' => $validated['scope'],
                'version' => $current->version + 1,
            ]);
            $job->customer->notify(new MarketplaceNotification(
                'A proposal was updated', $job->title, 'requests.show', ['serviceRequest' => $job->id],
            ));

            return $current;
        }, 3);
    }
}
