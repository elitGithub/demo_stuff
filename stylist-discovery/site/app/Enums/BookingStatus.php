<?php

namespace App\Enums;

enum BookingStatus: string
{
    case Requested = 'requested';
    case AwaitingDeposit = 'awaiting_deposit';
    case Confirmed = 'confirmed';
    case Declined = 'declined';
    case Cancelled = 'cancelled';
    case Expired = 'expired';
    case Completed = 'completed';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Requested => 'Requested',
            self::AwaitingDeposit => 'Awaiting Deposit',
            self::Confirmed => 'Confirmed',
            self::Declined => 'Declined',
            self::Cancelled => 'Cancelled',
            self::Expired => 'Expired',
            self::Completed => 'Completed',
        };
    }
}
