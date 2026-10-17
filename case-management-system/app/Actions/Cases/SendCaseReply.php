<?php

namespace App\Actions\Cases;

use App\Contracts\MailboxConnector;
use App\Data\OutgoingReply;
use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\MessageDirection;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Support\SenderAddress;
use Illuminate\Support\Facades\DB;
use Throwable;

final class SendCaseReply
{
    /**
     * @param  MailboxConnector  $connector
     * @param  ChangeCaseStatus  $changeStatus
     */
    public function __construct(
        private readonly MailboxConnector $connector,
        private readonly ChangeCaseStatus $changeStatus,
    ) {}

    /**
     * @param  CaseRecord  $case
     * @param  string  $bodyText
     * @return CaseMessage
     *
     * @throws Throwable
     */
    public function __invoke(CaseRecord $case, string $bodyText): CaseMessage
    {
        return DB::transaction(function () use ($case, $bodyText): CaseMessage {
            $current = CaseRecord::query()->lockForUpdate()->findOrFail($case->getKey());
            $latest = $current->latestMessage()->firstOrFail();
            $subject = 'Re: '.$current->subject;
            $sent = $this->connector->send(new OutgoingReply(
                threadId: $current->thread_id,
                to: new SenderAddress(email: $current->sender_email, name: $current->sender_name),
                subject: $subject,
                bodyText: $bodyText,
                inReplyToGmailMessageId: $latest->gmail_message_id,
            ));
            $owner = SenderAddress::fromHeader(config('casefile.owner.email'));
            $message = $current->messages()->create([
                'mailbox_message_id' => $sent->mailboxMessageId,
                'gmail_message_id' => $sent->gmailMessageId,
                'thread_id' => $sent->threadId,
                'direction' => MessageDirection::Outbound,
                'from_email' => $owner->email,
                'from_name' => config('casefile.owner.name'),
                'to_email' => $current->sender_email,
                'subject' => $subject,
                'body_text' => $bodyText,
                'sent_at' => $sent->sentAt,
            ]);
            $current->events()->create(['kind' => CaseEventKind::ReplySent, 'occurred_at' => $sent->sentAt]);

            if ($current->status === CaseStatus::Closed) {
                ($this->changeStatus)(case: $current, to: CaseStatus::Open);
            }

            return $message;
        });
    }
}
