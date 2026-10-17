<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Quote;
use App\Models\User;

class QuotePolicy
{
    public function view(User $user, Quote $quote): bool
    {
        return $user->id === $quote->provider_id || $user->id === $quote->serviceRequest->customer_id
            || $user->role === Role::Admin;
    }

    public function update(User $user, Quote $quote): bool
    {
        return $user->role === Role::Provider && $user->id === $quote->provider_id;
    }

    public function accept(User $user, Quote $quote): bool
    {
        return $user->role === Role::Customer && $user->id === $quote->serviceRequest->customer_id;
    }
}
