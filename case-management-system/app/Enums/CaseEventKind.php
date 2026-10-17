<?php

namespace App\Enums;

enum CaseEventKind: string
{
    case Created = 'created';
    case MessageReceived = 'message_received';
    case ReplySent = 'reply_sent';
    case StatusChanged = 'status_changed';
    case Reopened = 'reopened';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Created => 'Case created',
            self::MessageReceived => 'Message received',
            self::ReplySent => 'Reply sent',
            self::StatusChanged => 'Status changed',
            self::Reopened => 'Case reopened',
        };
    }
}
