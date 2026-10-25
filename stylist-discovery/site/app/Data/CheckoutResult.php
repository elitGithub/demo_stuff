<?php

namespace App\Data;

use App\Enums\CheckoutOutcome;
use App\Models\Booking;

readonly class CheckoutResult
{
    /** @param Booking $booking
     * @param CheckoutOutcome $outcome
     * @return void */
    public function __construct(public Booking $booking, public CheckoutOutcome $outcome) {}
}
