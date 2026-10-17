<?php

namespace App\Actions\Jobs;

use App\Enums\JobStatus;
use App\Enums\ProviderStatus;
use App\Exceptions\WorkflowConflict;
use App\Models\ProviderProfile;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class TransitionJob
{
    public function handle(User $actor, ServiceRequest $request, JobStatus $target): ServiceRequest
    {
        return DB::transaction(function () use ($actor, $request, $target): ServiceRequest {
            $job = ServiceRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('transition', $job);
            $isCustomer = $job->customer_id === $actor->id;
            if (! $isCustomer) {
                $profile = ProviderProfile::where('user_id', $actor->id)->lockForUpdate()->first();
                abort_unless($profile?->status === ProviderStatus::Approved, 403);
            }
            if ($target === $job->status) {
                return $job;
            }
            $allowed = match ($job->status) {
                JobStatus::Booked => ! $isCustomer ? JobStatus::InProgress : null,
                JobStatus::InProgress => ! $isCustomer ? JobStatus::AwaitingConfirmation : null,
                JobStatus::AwaitingConfirmation => $isCustomer ? JobStatus::Completed : null,
                default => null,
            };
            if ($target !== $allowed) {
                throw new WorkflowConflict('This action is unavailable at the current job stage.');
            }

            $description = match ($target) {
                JobStatus::InProgress => 'Your professional started the work.',
                JobStatus::AwaitingConfirmation => 'Work is ready for the customer to confirm.',
                JobStatus::Completed => 'The customer confirmed the job is complete.',
                default => throw new \LogicException('Unexpected job transition.'),
            };
            $job->update(['status' => $target]);
            $job->events()->create(['actor_id' => $actor->id, 'type' => $target->value, 'description' => $description]);
            ($isCustomer ? $job->acceptedQuote->provider : $job->customer)->notify(new MarketplaceNotification(
                'Your project has an update', $description, 'requests.show', ['serviceRequest' => $job->id],
            ));

            return $job;
        }, 3);
    }
}
