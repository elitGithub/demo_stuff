<?php

namespace App\Policies;

use App\Enums\AccountRole;
use App\Models\StylistProfile;
use App\Models\User;

class StylistProfilePolicy
{
    /**
     * @param  User  $user
     * @param  StylistProfile  $stylistProfile
     * @return bool
     */
    public function update(User $user, StylistProfile $stylistProfile): bool
    {
        return $user->hasRole(AccountRole::Stylist) && $stylistProfile->user_id === $user->id;
    }
}
