<?php

namespace App\Policies;

use App\Enums\AccountRole;
use App\Models\Booking;
use App\Models\User;

class BookingPolicy
{
    /**
     * @param  User  $user
     * @param  Booking  $booking
     * @return bool
     */
    public function view(User $user, Booking $booking): bool
    {
        return ($user->hasRole(AccountRole::Client) && $booking->client_id === $user->id) || $this->decide($user, $booking);
    }

    /**
     * @param  User  $user
     * @param  Booking  $booking
     * @return bool
     */
    public function decide(User $user, Booking $booking): bool
    {
        return $user->hasRole(AccountRole::Stylist) && $booking->profile->user_id === $user->id;
    }

    /** @param User $user
     * @param Booking $booking
     * @return bool */
    public function pay(User $user, Booking $booking): bool
    {
        return $user->hasRole(AccountRole::Client) && $booking->client_id === $user->id;
    }

    /** @param User $user
     * @param Booking $booking
     * @return bool */
    public function cancel(User $user, Booking $booking): bool
    {
        return $this->view($user, $booking);
    }
}
