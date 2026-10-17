<?php

namespace App\Mailbox;

use App\Contracts\MailboxConnector;
use App\Data\IncomingAttachment;
use App\Data\IncomingMessage;
use App\Data\MailboxPull;
use App\Data\OutgoingReply;
use App\Data\RejectedMailboxMessage;
use App\Data\SentReply;
use App\Enums\MailboxLabel;
use App\Models\MailboxAttachment;
use App\Models\MailboxMessage;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Throwable;

final class SimulatedMailbox implements MailboxConnector
{
    /**
     * @param  ?string  $cursor
     * @return MailboxPull
     *
     * @throws InvalidArgumentException
     */
    public function pull(?string $cursor): MailboxPull
    {
        if ($cursor !== null && preg_match('/^\d+$/D', $cursor) !== 1) {
            throw new InvalidArgumentException('Mailbox cursor must be a non-negative integer.');
        }

        $rows = MailboxMessage::query()->with('attachments')
            ->where('label', MailboxLabel::Inbox)
            ->when($cursor !== null, fn ($query) => $query->where('id', '>', $cursor))
            ->orderBy('received_at')->orderBy('id')->get();
        $nextCursor = $rows->isEmpty() ? $cursor : (string) $rows->max('id');

        return $this->hydrate(rows: $rows, cursor: $nextCursor);
    }

    /**
     * @param  SenderAddress  $sender
     * @return MailboxPull
     */
    public function backfill(SenderAddress $sender): MailboxPull
    {
        $rows = MailboxMessage::query()->with('attachments')
            ->where('label', MailboxLabel::Inbox)
            ->whereNotExists(fn (Builder $query) => $query->selectRaw('1')->from('cases')->whereColumn('cases.thread_id', 'mailbox_messages.thread_id'))
            ->orderBy('received_at')->orderBy('id')->get();
        $pull = $this->hydrate(rows: $rows, cursor: null);
        $matchingThreadIds = [];

        foreach ($pull->messages as $message) {
            if (! $message->isNotification && $message->from->equals($sender)) {
                $matchingThreadIds[] = $message->threadId;
            }
        }

        $selectedMessageIds = $rows->whereIn('thread_id', $matchingThreadIds)->pluck('gmail_message_id')->all();

        return new MailboxPull(
            messages: array_values(array_filter($pull->messages, fn (IncomingMessage $message): bool => in_array($message->threadId, $matchingThreadIds, true))),
            cursor: null,
            rejected: array_values(array_filter($pull->rejected, fn (RejectedMailboxMessage $message): bool => in_array($message->gmailMessageId, $selectedMessageIds, true))),
        );
    }

    /**
     * @param  OutgoingReply  $reply
     * @return SentReply
     *
     * @throws Throwable
     */
    public function send(OutgoingReply $reply): SentReply
    {
        return DB::transaction(function () use ($reply): SentReply {
            $sentAt = CarbonImmutable::now()->startOfSecond();
            $gmailMessageId = 'sim-'.Str::uuid();
            $owner = SenderAddress::fromHeader(config('casefile.owner.email'));
            $isNotification = $reply->to->equals($owner);
            $from = $isNotification
                ? new SenderAddress(email: config('casefile.notifications.email'), name: config('casefile.notifications.name'))
                : new SenderAddress(email: $owner->email, name: config('casefile.owner.name'));
            $mailboxMessageId = null;

            foreach ($isNotification ? [MailboxLabel::Sent, MailboxLabel::Inbox] : [MailboxLabel::Sent] as $label) {
                $mailboxMessage = MailboxMessage::query()->create([
                    'gmail_message_id' => $label === MailboxLabel::Sent ? $gmailMessageId : $gmailMessageId.'-inbox',
                    'thread_id' => $reply->threadId,
                    'label' => $label,
                    'from_email' => $from->email,
                    'from_name' => $from->name,
                    'to_email' => $reply->to->email,
                    'subject' => $reply->subject,
                    'body_text' => $reply->bodyText,
                    'snippet' => Str::limit($reply->bodyText, 160, ''),
                    'is_notification' => $isNotification,
                    'received_at' => $sentAt,
                ]);

                if ($label === MailboxLabel::Sent) {
                    $mailboxMessageId = $mailboxMessage->id;
                }
            }

            return new SentReply(gmailMessageId: $gmailMessageId, threadId: $reply->threadId, sentAt: $sentAt, mailboxMessageId: $mailboxMessageId);
        });
    }

    /**
     * @param  Collection<int, MailboxMessage>  $rows
     * @param  ?string  $cursor
     * @return MailboxPull
     */
    private function hydrate(Collection $rows, ?string $cursor): MailboxPull
    {
        $messages = [];
        $rejected = [];

        foreach ($rows as $row) {
            try {
                $from = SenderAddress::fromHeader($row->from_email);
            } catch (InvalidArgumentException) {
                $reason = 'Sender header has no valid address.';
                $rejected[] = new RejectedMailboxMessage(gmailMessageId: $row->gmail_message_id, reason: $reason);
                Log::warning('Mailbox message ignored.', ['gmail_message_id' => $row->gmail_message_id, 'reason' => $reason]);

                continue;
            }

            $messages[] = new IncomingMessage(
                gmailMessageId: $row->gmail_message_id,
                threadId: $row->thread_id,
                from: new SenderAddress(email: $from->email, name: $from->name ?? $row->from_name),
                toEmail: $row->to_email,
                subject: $row->subject,
                bodyText: $row->body_text,
                receivedAt: $row->received_at,
                attachments: $row->attachments->map(fn (MailboxAttachment $attachment): IncomingAttachment => new IncomingAttachment(
                    filename: $attachment->filename,
                    mimeType: $attachment->mime_type,
                    sizeBytes: $attachment->size_bytes,
                    storagePath: $attachment->storage_path,
                ))->all(),
                mailboxMessageId: $row->id,
                isNotification: $row->is_notification,
            );
        }

        return new MailboxPull(messages: $messages, cursor: $cursor, rejected: $rejected);
    }
}
