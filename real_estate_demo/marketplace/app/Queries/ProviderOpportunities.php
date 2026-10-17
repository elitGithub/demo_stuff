<?php

namespace App\Queries;

use App\Enums\JobStatus;
use App\Enums\ProviderStatus;
use App\Enums\Role;
use App\Models\ServiceRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class ProviderOpportunities
{
    public function forUser(User $provider): Builder
    {
        $profile = $provider->profile;
        $query = ServiceRequest::query()->where('status', JobStatus::Open);

        if ($provider->role !== Role::Provider || $profile?->status !== ProviderStatus::Approved) {
            return $query->whereRaw('1 = 0');
        }

        return $query->whereIn('service_area', $profile->service_areas)
            ->whereIn('category_id', $profile->categories()->where('is_active', true)->pluck('categories.id'));
    }
}
