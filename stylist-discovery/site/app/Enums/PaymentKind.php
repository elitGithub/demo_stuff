<?php

namespace App\Enums;

enum PaymentKind: string
{
    case Deposit = 'deposit';
    case Refund = 'refund';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Deposit => 'Deposit',
            self::Refund => 'Refund',
        };
    }
}
