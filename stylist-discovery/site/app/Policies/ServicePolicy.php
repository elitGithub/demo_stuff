<?php

namespace App\Policies;

use App\Enums\AccountRole;
use App\Models\Service;
use App\Models\User;

class ServicePolicy
{
    /**
     * @param  User  $user
     * @return bool
     */
    public function create(User $user): bool
    {
        return $user->hasRole(AccountRole::Stylist);
    }

    /**
     * @param  User  $user
     * @param  Service  $service
     * @return bool
     */
    public function update(User $user, Service $service): bool
    {
        return $user->hasRole(AccountRole::Stylist) && $service->profile->user_id === $user->id;
    }
}
