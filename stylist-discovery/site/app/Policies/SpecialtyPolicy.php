<?php

namespace App\Policies;

use App\Enums\AccountRole;
use App\Models\Specialty;
use App\Models\User;

class SpecialtyPolicy
{
    /** @param User $user
     * @param Specialty $specialty
     * @return bool */
    public function update(User $user, Specialty $specialty): bool
    {
        return $user->hasRole(AccountRole::Admin);
    }
}
