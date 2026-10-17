<?php

namespace App\Enums;

enum QuoteStatus: string
{
    case Pending = 'pending';
    case Accepted = 'accepted';
    case Declined = 'declined';

    public function label(): string
    {
        return ucfirst(str_replace('_', ' ', $this->value));
    }
}
