<?php

namespace App\Enums;

enum JobStatus: string
{
    case Open = 'open';
    case Booked = 'booked';
    case InProgress = 'in_progress';
    case AwaitingConfirmation = 'awaiting_confirmation';
    case Completed = 'completed';
    case Cancelled = 'cancelled';

    public function label(): string
    {
        return ucfirst(str_replace('_', ' ', $this->value));
    }
}
