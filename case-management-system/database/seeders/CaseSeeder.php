<?php

namespace Database\Seeders;

use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\MailboxLabel;
use App\Enums\MessageDirection;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\TrackedSender;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\CreatesMailboxMessages;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Seeder;
use InvalidArgumentException;
use RuntimeException;

class CaseSeeder extends Seeder
{
    use CreatesMailboxMessages;

    /**
     * @param  CarbonImmutable  $seededAt
     * @return void
     *
     * @throws InvalidArgumentException
     * @throws ModelNotFoundException
     * @throws RuntimeException
     */
    public function run(CarbonImmutable $seededAt): void
    {
        $owner = new SenderAddress(email: config('casefile.owner.email'), name: config('casefile.owner.name'));
        $at = fn (array $ago): CarbonImmutable => $seededAt->subDays($ago['days'])->subMinutes($ago['minutes']);

        foreach (require database_path('seeders/data/cases.php') as $row) {
            $sender = TrackedSender::query()->where('email', SenderAddress::fromHeader($row['sender'])->email)->firstOrFail();
            $correspondent = new SenderAddress(email: $sender->email, name: $sender->name);

            $case = CaseRecord::query()->create([
                'number' => $row['number'],
                'status' => CaseStatus::Open,
                'issue' => $row['issue'],
                'notes' => $row['notes'],
                'tracked_sender_id' => $sender->id,
                'sender_email' => $sender->email,
                'sender_name' => $sender->name,
                'subject' => $row['subject'],
                'thread_id' => $row['thread_id'],
                'received_at' => $at($row['messages'][0]['ago']),
                'closed_at' => null,
            ]);

            foreach ($row['messages'] as $index => $message) {
                $sentAt = $at($message['ago']);
                $subject = $index === 0 ? $row['subject'] : 'Re: '.$row['subject'];

                [$label, $from, $to, $kind] = match ($message['direction']) {
                    MessageDirection::Inbound => [MailboxLabel::Inbox, $correspondent, $owner, CaseEventKind::MessageReceived],
                    MessageDirection::Outbound => [MailboxLabel::Sent, $owner, $correspondent, CaseEventKind::ReplySent],
                };

                $mailboxMessage = $this->createMailboxMessage(
                    gmailMessageId: $message['gmail_message_id'],
                    threadId: $row['thread_id'],
                    label: $label,
                    from: $from,
                    toEmail: $to->email,
                    subject: $subject,
                    bodyText: $message['body_text'],
                    isNotification: false,
                    receivedAt: $sentAt,
                );

                $caseMessage = CaseMessage::query()->create([
                    'case_id' => $case->id,
                    'mailbox_message_id' => $mailboxMessage->id,
                    'gmail_message_id' => $message['gmail_message_id'],
                    'thread_id' => $row['thread_id'],
                    'direction' => $message['direction'],
                    'from_email' => $from->email,
                    'from_name' => $from->name,
                    'to_email' => $to->email,
                    'subject' => $subject,
                    'body_text' => $message['body_text'],
                    'sent_at' => $sentAt,
                ]);

                foreach ($message['attachments'] as $fixture) {
                    $attachment = [
                        'filename' => $fixture->value,
                        'mime_type' => $fixture->mimeType(),
                        'size_bytes' => $fixture->sizeBytes(),
                        'storage_path' => $fixture->value,
                    ];

                    $mailboxMessage->attachments()->create($attachment);
                    $caseMessage->attachments()->create($attachment);
                }

                $case->events()->create([
                    'kind' => $index === 0 ? CaseEventKind::Created : $kind,
                    'from_status' => null,
                    'to_status' => null,
                    'occurred_at' => $sentAt,
                ]);
            }

            foreach ($row['status_changes'] as $change) {
                $changedAt = $at($change['ago']);

                $case->events()->create([
                    'kind' => CaseEventKind::StatusChanged,
                    'from_status' => $case->status,
                    'to_status' => $change['to'],
                    'occurred_at' => $changedAt,
                ]);

                $case->status = $change['to'];
                $case->closed_at = $change['to'] === CaseStatus::Closed ? $changedAt : null;
            }

            $case->save();
        }
    }
}
