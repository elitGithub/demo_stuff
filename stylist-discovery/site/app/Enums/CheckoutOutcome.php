<?php

namespace App\Enums;

enum CheckoutOutcome: string
{
    case Succeeded = 'succeeded';
    case Failed = 'failed';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Succeeded => 'Succeeded',
            self::Failed => 'Failed',
        };
    }
}
