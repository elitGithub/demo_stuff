<?php

namespace App\Actions\Requests;

use App\Enums\JobStatus;
use App\Models\ServiceRequest;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use App\Queries\MatchingProviders;
use App\Services\RequestPhotoStorage;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Throwable;

class CreateServiceRequest
{
    public function __construct(private RequestPhotoStorage $storage, private MatchingProviders $matching) {}

    public function handle(User $actor, array $validated, array $photos): ServiceRequest
    {
        Gate::forUser($actor)->authorize('create', ServiceRequest::class);
        $written = [];

        try {
            return DB::transaction(function () use ($actor, $validated, $photos, &$written): ServiceRequest {
                $job = $actor->requests()->create([
                    'category_id' => $validated['category_id'],
                    'title' => $validated['title'], 'description' => $validated['description'],
                    'service_area' => $validated['service_area'], 'street_address' => $validated['street_address'],
                    'preferred_date' => $validated['preferred_date'],
                    'budget_cents' => isset($validated['budget']) ? Money::parse($validated['budget']) : null,
                    'status' => JobStatus::Open,
                ]);
                foreach ($photos as $photo) {
                    $stored = $this->storage->store($photo);
                    $written[] = $stored['path'];
                    $job->photos()->create($stored);
                }
                $job->events()->create([
                    'actor_id' => $actor->id, 'type' => 'posted', 'description' => 'Request shared with local professionals.',
                ]);
                foreach ($this->matching->forRequest($job)->get() as $provider) {
                    $provider->notify(new MarketplaceNotification(
                        'A new opportunity nearby', $job->title, 'requests.show', ['serviceRequest' => $job->id],
                    ));
                }

                return $job;
            });
        } catch (Throwable $exception) {
            foreach ($written as $path) {
                $this->storage->delete($path);
            }
            throw $exception;
        }
    }
}
