<?php

namespace App\Actions\Jobs;

use App\Enums\JobStatus;
use App\Enums\QuoteStatus;
use App\Exceptions\WorkflowConflict;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class CancelJob
{
    public function handle(User $actor, ServiceRequest $request): ServiceRequest
    {
        return DB::transaction(function () use ($actor, $request): ServiceRequest {
            $job = ServiceRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('cancel', $job);
            if ($job->status === JobStatus::Cancelled) {
                return $job;
            }
            if (! in_array($job->status, [JobStatus::Open, JobStatus::Booked], true)) {
                throw new WorkflowConflict('A job can only be cancelled before work starts.');
            }
            $quotes = $job->quotes()->whereIn('status', [QuoteStatus::Pending, QuoteStatus::Accepted])->with('provider')->get();
            foreach ($quotes as $quote) {
                if ($quote->status === QuoteStatus::Pending) {
                    $quote->update(['status' => QuoteStatus::Declined]);
                }
                $quote->provider->notify(new MarketplaceNotification(
                    'A request was cancelled', $job->title, 'requests.show', ['serviceRequest' => $job->id],
                ));
            }
            $job->update(['status' => JobStatus::Cancelled]);
            $job->events()->create(['actor_id' => $actor->id, 'type' => 'cancelled', 'description' => 'The customer cancelled this request.']);

            return $job;
        }, 3);
    }
}
