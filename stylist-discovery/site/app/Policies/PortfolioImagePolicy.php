<?php

namespace App\Policies;

use App\Enums\AccountRole;
use App\Enums\ProfileStatus;
use App\Models\PortfolioImage;
use App\Models\User;

class PortfolioImagePolicy
{
    /**
     * @param  User  $user
     * @param  PortfolioImage  $portfolioImage
     * @return bool
     */
    public function view(User $user, PortfolioImage $portfolioImage): bool
    {
        return $portfolioImage->profile->status === ProfileStatus::Published || $portfolioImage->profile->user_id === $user->id || $user->hasRole(AccountRole::Admin);
    }

    /**
     * @param  User  $user
     * @return bool
     */
    public function create(User $user): bool
    {
        return $user->hasRole(AccountRole::Stylist) && $user->profile()->exists();
    }

    /**
     * @param  User  $user
     * @param  PortfolioImage  $portfolioImage
     * @return bool
     */
    public function delete(User $user, PortfolioImage $portfolioImage): bool
    {
        return $user->hasRole(AccountRole::Stylist) && $portfolioImage->profile->user_id === $user->id && $portfolioImage->seed_asset === null;
    }
}
