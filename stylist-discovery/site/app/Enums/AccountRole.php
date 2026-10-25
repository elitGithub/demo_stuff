<?php

namespace App\Enums;

enum AccountRole: string
{
    case Client = 'client';
    case Stylist = 'stylist';
    case Admin = 'admin';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Client => 'Client',
            self::Stylist => 'Stylist',
            self::Admin => 'Admin',
        };
    }
}
