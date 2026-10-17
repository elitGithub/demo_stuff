<?php

namespace App\Enums;

enum ProviderStatus: string
{
    case Pending = 'pending';
    case Approved = 'approved';
    case Suspended = 'suspended';

    public function label(): string
    {
        return ucfirst(str_replace('_', ' ', $this->value));
    }
}
