<?php

namespace App\Intake;

use App\Actions\Cases\AllocateCaseNumber;
use App\Contracts\MailboxConnector;
use App\Data\IncomingMessage;
use App\Data\IntakeOutcome;
use App\Data\OutgoingReply;
use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\IntakeResult;
use App\Enums\MessageDirection;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\TrackedSender;
use App\Models\User;
use App\Notifications\CaseCreated;
use App\Notifications\CaseReopened;
use App\Support\SenderAddress;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

final class CaseIntake
{
    /**
     * @param  MailboxConnector  $connector
     * @param  AllocateCaseNumber  $allocateNumber
     */
    public function __construct(
        private readonly MailboxConnector $connector,
        private readonly AllocateCaseNumber $allocateNumber,
    ) {}

    /**
     * @param  IncomingMessage  $message
     * @return IntakeOutcome
     *
     * @throws Throwable
     */
    public function ingest(IncomingMessage $message): IntakeOutcome
    {
        return DB::transaction(function () use ($message): IntakeOutcome {
            if ($message->isNotification || in_array($message->from->email, [
                SenderAddress::fromHeader(config('casefile.notifications.email'))->email,
                SenderAddress::fromHeader(config('casefile.owner.email'))->email,
            ], true)) {
                return new IntakeOutcome(result: IntakeResult::Ignored, case: null, message: null, reason: 'Casefile notification or owner mail.', gmailMessageId: $message->gmailMessageId);
            }

            $sender = TrackedSender::query()->where('email', $message->from->email)->where('is_active', true)->first();

            if ($sender === null) {
                return new IntakeOutcome(result: IntakeResult::Ignored, case: null, message: null, reason: 'Sender is not actively tracked.', gmailMessageId: $message->gmailMessageId);
            }

            $duplicate = CaseMessage::query()->where('gmail_message_id', $message->gmailMessageId)->first();

            if ($duplicate !== null) {
                return new IntakeOutcome(result: IntakeResult::Ignored, case: $duplicate->case, message: $duplicate, reason: 'Message was already ingested.', gmailMessageId: $message->gmailMessageId);
            }

            $case = CaseRecord::query()->where('thread_id', $message->threadId)->lockForUpdate()->first();
            $result = IntakeResult::Appended;

            if ($case === null) {
                $case = CaseRecord::query()->create([
                    'number' => ($this->allocateNumber)(),
                    'status' => CaseStatus::Open,
                    'tracked_sender_id' => $sender->id,
                    'sender_email' => $message->from->email,
                    'sender_name' => $message->from->name ?? $sender->name,
                    'subject' => $message->subject,
                    'thread_id' => $message->threadId,
                    'received_at' => $message->receivedAt,
                ]);
                $result = IntakeResult::Created;
                $case->events()->create(['kind' => CaseEventKind::Created, 'occurred_at' => $message->receivedAt]);
            } else {
                $case->events()->create(['kind' => CaseEventKind::MessageReceived, 'occurred_at' => $message->receivedAt]);

                if ($case->status === CaseStatus::Closed) {
                    $case->fill(['status' => CaseStatus::Open, 'closed_at' => null])->save();
                    $case->events()->create([
                        'kind' => CaseEventKind::Reopened,
                        'from_status' => CaseStatus::Closed,
                        'to_status' => CaseStatus::Open,
                        'occurred_at' => $message->receivedAt,
                    ]);
                    $result = IntakeResult::Reopened;
                }
            }

            $stored = $case->messages()->create([
                'mailbox_message_id' => $message->mailboxMessageId,
                'gmail_message_id' => $message->gmailMessageId,
                'thread_id' => $message->threadId,
                'direction' => MessageDirection::Inbound,
                'from_email' => $message->from->email,
                'from_name' => $message->from->name,
                'to_email' => $message->toEmail,
                'subject' => $message->subject,
                'body_text' => $message->bodyText,
                'sent_at' => $message->receivedAt,
            ]);

            foreach ($message->attachments as $attachment) {
                $stored->attachments()->create([
                    'filename' => $attachment->filename,
                    'mime_type' => $attachment->mimeType,
                    'size_bytes' => $attachment->sizeBytes,
                    'storage_path' => $attachment->storagePath,
                ]);
            }

            if ($result === IntakeResult::Created || $result === IntakeResult::Reopened) {
                $owner = User::query()->where('email', config('casefile.owner.email'))->sole();
                $owner->notify($result === IntakeResult::Created ? new CaseCreated(case: $case) : new CaseReopened(case: $case));
                $subject = $result === IntakeResult::Created
                    ? 'New case '.$case->number.': '.$case->subject
                    : 'Case '.$case->number.' reopened: '.$case->subject;
                $this->connector->send(new OutgoingReply(
                    threadId: 'notification-'.Str::uuid(),
                    to: new SenderAddress(email: $owner->email, name: $owner->name),
                    subject: $subject,
                    bodyText: $subject."\n\nOpen Casefile to read the full message and reply.",
                    inReplyToGmailMessageId: $message->gmailMessageId,
                ));
            }

            return new IntakeOutcome(result: $result, case: $case, message: $stored, gmailMessageId: $message->gmailMessageId);
        });
    }
}
