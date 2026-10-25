<?php

namespace App\Enums;

enum ProfileStatus: string
{
    case Draft = 'draft';
    case Pending = 'pending';
    case Published = 'published';
    case Suspended = 'suspended';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Draft => 'Draft',
            self::Pending => 'Pending',
            self::Published => 'Published',
            self::Suspended => 'Suspended',
        };
    }
}
