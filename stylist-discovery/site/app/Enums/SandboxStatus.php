<?php

namespace App\Enums;

enum SandboxStatus: string
{
    case Allocating = 'allocating';
    case Active = 'active';
    case Retiring = 'retiring';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Allocating => 'Allocating',
            self::Active => 'Active',
            self::Retiring => 'Retiring',
        };
    }
}
