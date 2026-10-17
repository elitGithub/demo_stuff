<?php

namespace App\Enums;

enum IntakeResult: string
{
    case Created = 'created';
    case Appended = 'appended';
    case Reopened = 'reopened';
    case Ignored = 'ignored';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Created => 'Case created',
            self::Appended => 'Added to case',
            self::Reopened => 'Case reopened',
            self::Ignored => 'Ignored',
        };
    }
}
