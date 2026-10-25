<?php

namespace App\Policies;

use App\Enums\AccountRole;
use App\Models\TimeOff;
use App\Models\User;

class TimeOffPolicy
{
    /**
     * @param  User  $user
     * @param  TimeOff  $timeOff
     * @return bool
     */
    public function delete(User $user, TimeOff $timeOff): bool
    {
        return $user->hasRole(AccountRole::Stylist) && $timeOff->profile->user_id === $user->id;
    }
}
