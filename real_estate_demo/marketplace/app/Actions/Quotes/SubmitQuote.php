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

class SubmitQuote
{
    public function __construct(private MatchingProviders $matching) {}

    public function handle(User $actor, ServiceRequest $request, array $validated): Quote
    {
        return DB::transaction(function () use ($actor, $request, $validated): Quote {
            $job = ServiceRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            ProviderProfile::where('user_id', $actor->id)->lockForUpdate()->first();
            abort_unless($this->matching->forRequest($job)->whereKey($actor->id)->exists(), 403);

            if ($job->status !== JobStatus::Open || $job->quotes()->where('provider_id', $actor->id)->exists()) {
                throw new WorkflowConflict('This request is no longer open, or you already sent a proposal. Refresh to continue.');
            }

            $quote = $job->quotes()->create([
                'provider_id' => $actor->id, 'amount_cents' => Money::parse($validated['amount'], 100),
                'available_date' => $validated['available_date'], 'scope' => $validated['scope'],
                'status' => QuoteStatus::Pending, 'version' => 1,
            ]);
            $job->customer->notify(new MarketplaceNotification(
                'A new proposal for your home', $job->title, 'requests.show', ['serviceRequest' => $job->id],
            ));

            return $quote;
        }, 3);
    }
}
