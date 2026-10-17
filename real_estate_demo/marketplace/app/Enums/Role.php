<?php

namespace App\Enums;

enum Role: string
{
    case Customer = 'customer';
    case Provider = 'provider';
    case Admin = 'admin';

    public function label(): string
    {
        return ucfirst(str_replace('_', ' ', $this->value));
    }
}
