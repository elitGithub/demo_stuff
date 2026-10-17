<?php

namespace App\Data;

final readonly class RejectedMailboxMessage
{
    /**
     * @param  string  $gmailMessageId
     * @param  string  $reason
     */
    public function __construct(
        public string $gmailMessageId,
        public string $reason,
    ) {}
}
