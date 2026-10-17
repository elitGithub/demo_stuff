<?php

namespace App\Policies;

use App\Enums\Role;
use App\Models\Payment;
use App\Models\ServiceRequest;
use App\Models\User;

class PaymentPolicy
{
    public function create(User $user, ServiceRequest $request): bool
    {
        return $user->role === Role::Customer && $request->customer_id === $user->id;
    }

    public function view(User $user, Payment $payment): bool
    {
        return $user->role === Role::Admin || $payment->customer_id === $user->id
            || ($user->role === Role::Provider && $payment->serviceRequest->acceptedQuote?->provider_id === $user->id);
    }
}
