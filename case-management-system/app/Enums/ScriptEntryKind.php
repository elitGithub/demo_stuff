<?php

namespace App\Enums;

enum ScriptEntryKind: string
{
    case Delivery = 'delivery';
    case ScriptedReply = 'scripted_reply';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Delivery => 'Delivery',
            self::ScriptedReply => 'Scripted reply',
        };
    }
}
