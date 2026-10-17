<?php

namespace App\Enums;

enum WorkspaceLayout: string
{
    case Tracker = 'tracker';
    case Desk = 'desk';
    case Mail = 'mail';
    case Board = 'board';

    /**
     * @return self
     */
    public static function default(): self
    {
        return self::Desk;
    }

    /**
     * @param  ?string  $value
     * @return ?self
     */
    public static function tryFromCookie(?string $value): ?self
    {
        if ($value === null || $value === '') {
            return null;
        }

        return self::tryFrom($value);
    }

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Tracker => 'Tracker',
            self::Desk => 'Conversation desk',
            self::Mail => 'Mail',
            self::Board => 'Board',
        };
    }
}
