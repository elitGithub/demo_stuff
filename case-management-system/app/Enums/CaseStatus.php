<?php

namespace App\Enums;

enum CaseStatus: string
{
    case Open = 'open';
    case InProgress = 'in_progress';
    case Closed = 'closed';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Open => 'Open',
            self::InProgress => 'In progress',
            self::Closed => 'Closed',
        };
    }

    /**
     * @return string
     */
    public function pillClass(): string
    {
        return match ($this) {
            self::Open => 'pill-open',
            self::InProgress => 'pill-progress',
            self::Closed => 'pill-closed',
        };
    }

    /**
     * @return string
     */
    public function glyphClass(): string
    {
        return match ($this) {
            self::Open => 'glyph-open',
            self::InProgress => 'glyph-progress',
            self::Closed => 'glyph-closed',
        };
    }
}
