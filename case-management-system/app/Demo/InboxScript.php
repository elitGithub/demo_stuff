<?php

namespace App\Demo;

use App\Data\DeliveryReport;
use App\Data\ScriptProgress;
use App\Enums\CaseStatus;
use App\Enums\IntakeResult;
use App\Enums\MailboxLabel;
use App\Enums\MessageDirection;
use App\Enums\ScriptEntryKind;
use App\Intake\IntakeRunner;
use App\Models\CaseRecord;
use App\Models\MailboxMessage;
use App\Models\ScriptEntry;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use Throwable;

final class InboxScript
{
    /**
     * @param  IntakeRunner  $runner
     */
    public function __construct(private readonly IntakeRunner $runner) {}

    /**
     * @return ?DeliveryReport
     *
     * @throws Throwable
     */
    public function deliverNext(): ?DeliveryReport
    {
        return DB::transaction(function (): ?DeliveryReport {
            $entry = ScriptEntry::query()
                ->where('kind', ScriptEntryKind::Delivery)
                ->whereNull('delivered_at')
                ->orderBy('position')->orderBy('id')
                ->lockForUpdate()->first();

            return $entry === null ? null : $this->consume(entry: $entry, case: null);
        });
    }

    /**
     * @param  ?CaseRecord  $case
     * @return ?DeliveryReport
     *
     * @throws Throwable
     */
    public function deliverReply(?CaseRecord $case = null): ?DeliveryReport
    {
        return DB::transaction(function () use ($case): ?DeliveryReport {
            $eligible = CaseRecord::query()
                ->whereExists(function (Builder $query): void {
                    $query->selectRaw('1')->from('script_entries')
                        ->whereColumn('script_entries.thread_id', 'cases.thread_id')
                        ->where('kind', ScriptEntryKind::ScriptedReply->value)
                        ->whereNull('delivered_at');
                })
                ->whereNotExists(function (Builder $query): void {
                    $query->selectRaw('1')->from('script_entries')
                        ->whereColumn('script_entries.thread_id', 'cases.thread_id')
                        ->where('kind', ScriptEntryKind::Delivery->value)
                        ->whereNull('delivered_at');
                });

            if ($case === null) {
                $eligible->where('status', '!=', CaseStatus::Closed);
            } else {
                $eligible->whereKey($case->id);
            }

            $selected = $eligible->orderBy('received_at')->orderBy('id')->lockForUpdate()->first();

            if ($selected === null) {
                return null;
            }

            $entry = ScriptEntry::query()->where('thread_id', $selected->thread_id)
                ->where('kind', ScriptEntryKind::ScriptedReply)->whereNull('delivered_at')
                ->orderBy('id')->lockForUpdate()->first();

            return $entry === null ? null : $this->consume(entry: $entry, case: $selected);
        });
    }

    /**
     * @param  CaseRecord  $case
     * @return ?DeliveryReport
     *
     * @throws Throwable
     */
    public function autoReply(CaseRecord $case): ?DeliveryReport
    {
        return DB::transaction(function () use ($case): ?DeliveryReport {
            $current = CaseRecord::query()->whereKey($case->id)->lockForUpdate()->firstOrFail();
            $latest = $current->latestMessage()->first();

            if ($latest === null || $latest->direction !== MessageDirection::Outbound) {
                return null;
            }

            return $this->deliverReply(case: $current);
        });
    }

    /**
     * @return ScriptProgress
     */
    public function progress(): ScriptProgress
    {
        $counts = ScriptEntry::query()->where('kind', ScriptEntryKind::Delivery)
            ->selectRaw('COUNT(*) AS total, COUNT(delivered_at) AS delivered')->toBase()->sole();

        return new ScriptProgress(delivered: (int) $counts->delivered, total: (int) $counts->total);
    }

    /**
     * @param  ScriptEntry  $entry
     * @param  ?CaseRecord  $case
     * @return DeliveryReport
     *
     * @throws Throwable
     */
    private function consume(ScriptEntry $entry, ?CaseRecord $case): DeliveryReport
    {
        $payload = $entry->payload;
        $sender = SenderAddress::fromHeader($payload['from']);
        $mailbox = MailboxMessage::query()->create([
            'gmail_message_id' => 'script-'.Str::uuid(),
            'thread_id' => $entry->thread_id,
            'label' => MailboxLabel::Inbox,
            'from_email' => $sender->email,
            'from_name' => $sender->name,
            'to_email' => config('casefile.owner.email'),
            'subject' => $entry->kind === ScriptEntryKind::Delivery ? $payload['subject'] : 'Re: '.$case->subject,
            'body_text' => $payload['body_text'],
            'snippet' => Str::limit($payload['body_text'], 150),
            'is_notification' => false,
            'received_at' => CarbonImmutable::now(),
        ]);

        foreach ($payload['attachments'] as $attachment) {
            $mailbox->attachments()->create([
                'filename' => $attachment['filename'],
                'mime_type' => $attachment['mime_type'],
                'size_bytes' => $attachment['size_bytes'],
                'storage_path' => $attachment['filename'],
            ]);
        }

        foreach ($this->runner->run() as $outcome) {
            if ($outcome->gmailMessageId !== $mailbox->gmail_message_id) {
                continue;
            }

            $summary = match ($outcome->result) {
                IntakeResult::Created => 'New case '.$outcome->case->number.' from '.$outcome->case->sender_name,
                IntakeResult::Appended => 'Added to '.$outcome->case->number,
                IntakeResult::Reopened => 'Reopened '.$outcome->case->number,
                IntakeResult::Ignored => $outcome->reason === 'Sender is not actively tracked.'
                    ? 'Ignored: '.$sender->email.' is not a tracked sender'
                    : 'Ignored: '.$outcome->reason,
            };
            $entry->fill(['delivered_at' => CarbonImmutable::now()])->save();

            return new DeliveryReport(outcome: $outcome, mailboxMessage: $mailbox, summary: $summary);
        }

        throw new LogicException('Scripted mailbox message was not returned by intake.');
    }
}
