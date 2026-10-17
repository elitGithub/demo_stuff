<?php

namespace App\Data;

use App\Models\MailboxMessage;

final readonly class DeliveryReport
{
    /**
     * @param  IntakeOutcome  $outcome
     * @param  MailboxMessage  $mailboxMessage
     * @param  string  $summary
     */
    public function __construct(
        public IntakeOutcome $outcome,
        public MailboxMessage $mailboxMessage,
        public string $summary,
    ) {}
}
