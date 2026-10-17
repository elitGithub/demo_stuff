<?php

namespace Database\Seeders\Concerns;

use App\Enums\MailboxLabel;
use App\Models\MailboxMessage;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

trait CreatesMailboxMessages
{
    /**
     * @param  string  $gmailMessageId
     * @param  string  $threadId
     * @param  MailboxLabel  $label
     * @param  SenderAddress  $from
     * @param  string  $toEmail
     * @param  string  $subject
     * @param  string  $bodyText
     * @param  bool  $isNotification
     * @param  CarbonImmutable  $receivedAt
     * @return MailboxMessage
     */
    protected function createMailboxMessage(
        string $gmailMessageId,
        string $threadId,
        MailboxLabel $label,
        SenderAddress $from,
        string $toEmail,
        string $subject,
        string $bodyText,
        bool $isNotification,
        CarbonImmutable $receivedAt,
    ): MailboxMessage {
        return MailboxMessage::query()->create([
            'gmail_message_id' => $gmailMessageId,
            'thread_id' => $threadId,
            'label' => $label,
            'from_email' => $from->email,
            'from_name' => $from->name,
            'to_email' => $toEmail,
            'subject' => $subject,
            'body_text' => $bodyText,
            'snippet' => mb_substr(Str::squish($bodyText), 0, 160),
            'is_notification' => $isNotification,
            'received_at' => $receivedAt,
        ]);
    }
}
