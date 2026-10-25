<?php

namespace App\Enums;

enum UploadStatus: string
{
    case Reserved = 'reserved';
    case Attached = 'attached';
    case Retiring = 'retiring';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Reserved => 'Reserved',
            self::Attached => 'Attached',
            self::Retiring => 'Retiring',
        };
    }
}
