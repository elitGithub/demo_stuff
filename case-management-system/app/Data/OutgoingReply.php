<?php

namespace App\Data;

use App\Support\SenderAddress;

final readonly class OutgoingReply
{
    /**
     * @param  string  $threadId
     * @param  SenderAddress  $to
     * @param  string  $subject
     * @param  string  $bodyText
     * @param  string  $inReplyToGmailMessageId
     */
    public function __construct(
        public string $threadId,
        public SenderAddress $to,
        public string $subject,
        public string $bodyText,
        public string $inReplyToGmailMessageId,
    ) {}
}
