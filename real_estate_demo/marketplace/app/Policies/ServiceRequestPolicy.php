<?php

namespace App\Policies;

use App\Enums\JobStatus;
use App\Enums\ProviderStatus;
use App\Enums\Role;
use App\Models\ServiceRequest;
use App\Models\User;

class ServiceRequestPolicy
{
    public function create(User $user): bool
    {
        return $user->role === Role::Customer;
    }

    public function view(User $user, ServiceRequest $request): bool
    {
        return $user->role === Role::Admin
            || $request->customer_id === $user->id
            || ($user->role === Role::Provider && (
                $this->quote($user, $request)
                || $request->quotes()->where('provider_id', $user->id)->exists()
            ));
    }

    public function viewPrivateDetails(User $user, ServiceRequest $request): bool
    {
        return $user->role === Role::Admin
            || $request->customer_id === $user->id
            || ($user->role === Role::Provider && $request->acceptedQuote?->provider_id === $user->id);
    }

    public function update(User $user, ServiceRequest $request): bool
    {
        return $user->role === Role::Customer && $request->customer_id === $user->id;
    }

    public function cancel(User $user, ServiceRequest $request): bool
    {
        return $user->role === Role::Customer && $request->customer_id === $user->id;
    }

    public function transition(User $user, ServiceRequest $request): bool
    {
        return ($user->role === Role::Customer && $request->customer_id === $user->id)
            || ($user->role === Role::Provider && $request->acceptedQuote?->provider_id === $user->id);
    }

    public function quote(User $user, ServiceRequest $request): bool
    {
        $profile = $user->profile;

        return $user->role === Role::Provider
            && $request->status === JobStatus::Open
            && $request->category->is_active
            && $profile?->status === ProviderStatus::Approved
            && in_array($request->service_area, $profile->service_areas, true)
            && $profile->categories()->whereKey($request->category_id)->exists();
    }
}
