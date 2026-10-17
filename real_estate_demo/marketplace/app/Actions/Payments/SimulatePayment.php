<?php

namespace App\Actions\Payments;

use App\Enums\JobStatus;
use App\Enums\QuoteStatus;
use App\Exceptions\WorkflowConflict;
use App\Models\Payment;
use App\Models\ServiceRequest;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

class SimulatePayment
{
    public function handle(User $actor, ServiceRequest $request): Payment
    {
        return DB::transaction(function () use ($actor, $request): Payment {
            $job = ServiceRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('create', [Payment::class, $job]);
            $this->ensureReady($job);

            return $job->payment()->first() ?? $job->payment()->create([
                'customer_id' => $job->customer_id, 'receipt_number' => (string) Str::uuid(),
                'amount_cents' => $job->acceptedQuote->amount_cents,
                'currency' => config('marketplace.currency'), 'status' => 'simulated_paid', 'paid_at' => now(),
            ]);
        }, 3);
    }

    public function ensureReady(ServiceRequest $job): void
    {
        if ($job->status !== JobStatus::Completed
            || $job->acceptedQuote?->status !== QuoteStatus::Accepted
            || $job->acceptedQuote->service_request_id !== $job->id) {
            throw new WorkflowConflict('Checkout is available after the completed work has been confirmed.');
        }
    }
}
