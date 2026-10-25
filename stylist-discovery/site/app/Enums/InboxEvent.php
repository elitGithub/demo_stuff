<?php

namespace App\Enums;

enum InboxEvent: string
{
    case RequestReceived = 'request_received';
    case RequestAccepted = 'request_accepted';
    case RequestDeclined = 'request_declined';
    case DepositPaid = 'deposit_paid';
    case BookingExpired = 'booking_expired';
    case BookingCancelled = 'booking_cancelled';
    case DepositRefunded = 'deposit_refunded';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::RequestReceived => 'Request Received',
            self::RequestAccepted => 'Request Accepted',
            self::RequestDeclined => 'Request Declined',
            self::DepositPaid => 'Deposit Paid',
            self::BookingExpired => 'Booking Expired',
            self::BookingCancelled => 'Booking Cancelled',
            self::DepositRefunded => 'Deposit Refunded',
        };
    }
}
