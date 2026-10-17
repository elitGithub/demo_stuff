<?php

namespace App\Data;

use App\Support\SenderAddress;
use Carbon\CarbonImmutable;

final readonly class IncomingMessage
{
    /**
     * @param  string  $gmailMessageId
     * @param  string  $threadId
     * @param  SenderAddress  $from
     * @param  string  $toEmail
     * @param  string  $subject
     * @param  string  $bodyText
     * @param  CarbonImmutable  $receivedAt
     * @param  list<IncomingAttachment>  $attachments
     * @param  ?int  $mailboxMessageId
     * @param  bool  $isNotification
     */
    public function __construct(
        public string $gmailMessageId,
        public string $threadId,
        public SenderAddress $from,
        public string $toEmail,
        public string $subject,
        public string $bodyText,
        public CarbonImmutable $receivedAt,
        public array $attachments,
        public ?int $mailboxMessageId = null,
        public bool $isNotification = false,
    ) {}
}
