<?php

namespace App\Actions\Requests;

use App\Enums\JobStatus;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class UpdateServiceRequest
{
    public function handle(User $actor, ServiceRequest $request, array $validated): ServiceRequest
    {
        return DB::transaction(function () use ($actor, $request, $validated): ServiceRequest {
            $job = ServiceRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            Gate::forUser($actor)->authorize('update', $job);
            abort_unless($job->status === JobStatus::Open && ! $job->quotes()->exists(), 409,
                'This request already has a proposal or booking. Its scope can no longer be changed.');

            $job->update([
                'category_id' => $validated['category_id'],
                'title' => $validated['title'], 'description' => $validated['description'],
                'service_area' => $validated['service_area'], 'street_address' => $validated['street_address'],
                'preferred_date' => $validated['preferred_date'],
                'budget_cents' => isset($validated['budget']) ? Money::parse($validated['budget']) : null,
            ]);

            return $job;
        }, 3);
    }
}
