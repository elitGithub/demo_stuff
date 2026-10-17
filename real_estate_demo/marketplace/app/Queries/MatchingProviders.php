<?php

namespace App\Queries;

use App\Enums\ProviderStatus;
use App\Enums\Role;
use App\Models\ServiceRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class MatchingProviders
{
    public function forRequest(ServiceRequest $request): Builder
    {
        return User::where('role', Role::Provider)->whereHas('profile', function (Builder $query) use ($request): void {
            $query->where('status', ProviderStatus::Approved)
                ->whereJsonContains('service_areas', $request->service_area)
                ->whereHas('categories', fn (Builder $categories) => $categories
                    ->where('categories.id', $request->category_id)->where('is_active', true));
        });
    }
}
