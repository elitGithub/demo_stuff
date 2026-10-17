<?php

namespace Database\Seeders;

use App\Enums\MailboxLabel;
use App\Models\CaseRecord;
use App\Models\User;
use App\Notifications\CaseCreated;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\CreatesMailboxMessages;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\Seeder;
use InvalidArgumentException;

class MailboxSeeder extends Seeder
{
    use CreatesMailboxMessages;

    /**
     * @param  CarbonImmutable  $seededAt
     * @return void
     *
     * @throws InvalidArgumentException
     * @throws ModelNotFoundException
     */
    public function run(CarbonImmutable $seededAt): void
    {
        $inbox = require database_path('seeders/data/inbox.php');
        $ownerEmail = config('casefile.owner.email');

        foreach ($inbox['messages'] as $message) {
            $this->createMailboxMessage(
                gmailMessageId: $message['gmail_message_id'],
                threadId: $message['thread_id'],
                label: MailboxLabel::Inbox,
                from: SenderAddress::fromHeader($message['from']),
                toEmail: $ownerEmail,
                subject: $message['subject'],
                bodyText: $message['body_text'],
                isNotification: false,
                receivedAt: $seededAt->subDays($message['ago']['days'])->subMinutes($message['ago']['minutes']),
            );
        }

        $notifications = $inbox['notifications'];
        $notifier = SenderAddress::fromHeader($notifications['from']);
        $owner = User::query()->where('email', $ownerEmail)->sole();

        foreach ($notifications['cases'] as $notification) {
            $case = CaseRecord::query()->where('number', $notification['number'])->firstOrFail();
            $replacements = [
                ':number' => $case->number,
                ':subject' => $case->subject,
                ':name' => $case->sender_name,
                ':email' => $case->sender_email,
            ];

            $this->createMailboxMessage(
                gmailMessageId: $notification['gmail_message_id'],
                threadId: $notification['thread_id'],
                label: MailboxLabel::Inbox,
                from: $notifier,
                toEmail: $ownerEmail,
                subject: strtr($notifications['subject'], $replacements),
                bodyText: strtr($notifications['body_text'], $replacements),
                isNotification: true,
                receivedAt: $case->received_at->addMinute(),
            );

            $owner->notify(new CaseCreated(case: $case));
        }
    }
}
