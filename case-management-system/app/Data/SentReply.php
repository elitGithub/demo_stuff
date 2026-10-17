<?php

namespace App\Data;

use Carbon\CarbonImmutable;

final readonly class SentReply
{
    /**
     * @param  string  $gmailMessageId
     * @param  string  $threadId
     * @param  CarbonImmutable  $sentAt
     * @param  ?int  $mailboxMessageId
     */
    public function __construct(
        public string $gmailMessageId,
        public string $threadId,
        public CarbonImmutable $sentAt,
        public ?int $mailboxMessageId = null,
    ) {}
}
