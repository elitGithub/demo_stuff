<?php

namespace App\Enums;

enum MailboxLabel: string
{
    case Inbox = 'inbox';
    case Sent = 'sent';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Inbox => 'Inbox',
            self::Sent => 'Sent',
        };
    }
}
