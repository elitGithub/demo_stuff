<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\ServiceRequest;
use App\Models\User;

class ReviewPolicy
{
    public function create(User $user, ServiceRequest $request): bool
    {
        return $user->role === Role::Customer && $request->customer_id === $user->id;
    }
}
