<?php

namespace Tests\Feature;

use App\Actions\Cases\AllocateCaseNumber;
use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\FixtureFile;
use App\Enums\MailboxLabel;
use App\Enums\MessageDirection;
use App\Enums\ScriptEntryKind;
use App\Models\Attachment;
use App\Models\CaseMessage;
use App\Models\CaseNumberSequence;
use App\Models\CaseRecord;
use App\Models\InstallationMeta;
use App\Models\MailboxAttachment;
use App\Models\MailboxMessage;
use App\Models\ScriptEntry;
use App\Models\TrackedSender;
use App\Models\User;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class DemoSeederTest extends TestCase
{
    use RefreshDatabase;

    private const array TIME_BOUND_WORDING = [
        'clock time with am or pm' => '/\b\d{1,2}(:\d{2})?\s?(a\.?m\b\.?|p\.?m\b\.?)/i',
        'clock time with minutes' => '/\b\d{1,2}:\d{2}\b/',
        'clock time after at, around, until or almost' => '/\b(at|around|until|almost) \d{1,2}\b/i',
        'o clock' => "/o'clock/i",
        'weekday name' => '/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)s?\b/',
        'time of day of sending' => '/\b(this (morning|afternoon|evening)|tonight|last night)\b/i',
        'this or next weekend' => '/\b(this|next) weekend\b/i',
        'numeric date' => '/\b(?!24\/7\b)((0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])|(0?[1-9]|[12]\d|3[01])\/(0?[1-9]|1[0-2]))\b(?![-\s]?(inch|inches|cm|mm|ft|foot|feet))/i',
        'month and day' => '/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.? \d{1,2}\b/',
        'day and month' => '/\b\d{1,2}(st|nd|rd|th)? (of )?(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/',
        'ordinal day' => '/\b\d{1,2}(st|nd|rd|th)\b/',
        'four-digit year' => '/\b(19|20)\d{2}\b/',
    ];

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
    }

    /**
     * @param  string  $name
     * @return array<array-key, mixed>
     */
    private function seedData(string $name): array
    {
        return require database_path('seeders/data/'.$name.'.php');
    }

    /**
     * @return void
     */
    public function test_owner_is_user_one_with_the_configured_identity(): void
    {
        $owner = User::query()->sole();

        $this->assertSame(1, $owner->id);
        $this->assertSame(config('casefile.owner.name'), $owner->name);
        $this->assertSame(config('casefile.owner.email'), $owner->email);
        $this->assertNull($owner->password);
    }

    /**
     * @return void
     */
    public function test_seeded_unread_database_notifications_match_the_notification_inbox_rows(): void
    {
        $owner = User::query()->sole();
        $notifications = $owner->unreadNotifications()->get();
        $this->assertCount(2, $notifications);
        $this->assertEqualsCanonicalizing(['CASE-0015', 'CASE-0016'], $notifications->pluck('data.number')->all());

        foreach ($notifications as $notification) {
            $case = CaseRecord::query()->findOrFail($notification->data['case_id']);
            $this->assertSame('created', $notification->data['result']);
            $this->assertSame($case->subject, $notification->data['subject']);
            $this->assertDatabaseHas('mailbox_messages', [
                'label' => MailboxLabel::Inbox->value,
                'is_notification' => true,
                'subject' => 'New case '.$case->number.': '.$case->subject,
            ]);
        }
    }

    /**
     * @return void
     */
    public function test_tracked_senders_are_the_five_from_the_brief_with_jade_inactive(): void
    {
        $expected = [
            'priya.nair@mail.example' => ['Priya Nair', 'Tenant, unit 2B', true],
            'marcus.leblanc@mail.example' => ['Marcus Leblanc', 'Tenant, unit 3A', true],
            'jade.okafor@mail.example' => ['Jade Okafor', 'Former tenant, unit 1A', false],
            'hello@northwaypm.example' => ['Northway Property Management', 'Property manager', true],
            'service@dufferinplumbing.example' => ['Dufferin Plumbing', 'Contractor', true],
        ];

        $senders = TrackedSender::query()->orderBy('id')->get()->keyBy('email');

        $this->assertSame(array_keys($expected), $senders->keys()->all());

        foreach ($expected as $email => [$name, $label, $active]) {
            $this->assertSame($name, $senders[$email]->name);
            $this->assertSame($label, $senders[$email]->label);
            $this->assertSame($active, $senders[$email]->is_active);
        }

        $this->assertSame(['jade.okafor@mail.example'], TrackedSender::query()->where('is_active', false)->pluck('email')->all());
        $this->assertGreaterThan(0, $senders['jade.okafor@mail.example']->cases()->count());
    }

    /**
     * @return void
     */
    public function test_sixteen_cases_split_five_open_two_in_progress_nine_closed(): void
    {
        $this->assertSame(16, CaseRecord::query()->count());
        $this->assertSame(5, CaseRecord::query()->where('status', CaseStatus::Open)->count());
        $this->assertSame(2, CaseRecord::query()->where('status', CaseStatus::InProgress)->count());
        $this->assertSame(9, CaseRecord::query()->where('status', CaseStatus::Closed)->count());
    }

    /**
     * @return void
     */
    public function test_case_numbers_run_from_one_to_sixteen_in_received_order(): void
    {
        $expected = array_map(fn (int $number): string => sprintf('CASE-%04d', $number), range(1, 16));

        $this->assertSame($expected, CaseRecord::query()->orderBy('received_at')->pluck('number')->all());
        $this->assertSame(16, CaseRecord::query()->distinct()->count('received_at'));
    }

    /**
     * @return void
     */
    public function test_received_dates_spread_over_the_forty_two_days_before_seeding(): void
    {
        $seededAt = InstallationMeta::query()->sole()->seeded_at;
        $oldest = CaseRecord::query()->orderBy('received_at')->firstOrFail();
        $newest = CaseRecord::query()->orderByDesc('received_at')->firstOrFail();

        $this->assertTrue($oldest->received_at->greaterThanOrEqualTo($seededAt->subDays(42)));
        $this->assertTrue($oldest->received_at->lessThan($seededAt->subDays(35)));
        $this->assertTrue($newest->received_at->lessThanOrEqualTo($seededAt));
        $this->assertTrue($newest->received_at->greaterThan($seededAt->subDay()));

        $this->assertSame('CASE-0016', $newest->number);
        $this->assertSame('Boiler not firing, unit 2B', $newest->subject);
        $this->assertSame('priya.nair@mail.example', $newest->trackedSender->email);
        $this->assertSame(CaseStatus::Open, $newest->status);
    }

    /**
     * @return void
     */
    public function test_case_threads_are_consistent_with_their_sender_and_owner(): void
    {
        $owner = config('casefile.owner.email');
        $seededAt = InstallationMeta::query()->sole()->seeded_at;

        foreach (CaseRecord::query()->with(['trackedSender', 'messages'])->get() as $case) {
            $this->assertSame($case->trackedSender->email, $case->sender_email, $case->number);
            $this->assertSame($case->trackedSender->name, $case->sender_name, $case->number);
            $this->assertNotEmpty($case->messages, $case->number);

            $first = $case->messages->first();
            $this->assertSame(MessageDirection::Inbound, $first->direction, $case->number);
            $this->assertTrue($first->sent_at->equalTo($case->received_at), $case->number);
            $this->assertSame($case->subject, $first->subject, $case->number);

            $previous = null;

            foreach ($case->messages as $index => $message) {
                $this->assertSame($case->thread_id, $message->thread_id, $case->number);
                $this->assertTrue($message->sent_at->lessThanOrEqualTo($seededAt), $case->number);

                if ($previous !== null) {
                    $this->assertTrue($message->sent_at->greaterThan($previous->sent_at), $case->number.' message order');
                }

                if ($index > 0) {
                    $this->assertSame('Re: '.$case->subject, $message->subject, $case->number);
                }

                match ($message->direction) {
                    MessageDirection::Inbound => $this->assertSame(
                        [$case->sender_email, $case->sender_name, $owner],
                        [$message->from_email, $message->from_name, $message->to_email],
                        $case->number,
                    ),
                    MessageDirection::Outbound => $this->assertSame(
                        [$owner, config('casefile.owner.name'), $case->sender_email],
                        [$message->from_email, $message->from_name, $message->to_email],
                        $case->number,
                    ),
                };

                $previous = $message;
            }
        }
    }

    /**
     * @return void
     */
    public function test_at_least_two_threads_carry_replies_in_both_directions(): void
    {
        $backAndForth = CaseRecord::query()->with('messages')->get()->filter(function (CaseRecord $case): bool {
            $directions = $case->messages->pluck('direction');

            return $case->messages->count() >= 3
                && $directions->contains(MessageDirection::Inbound)
                && $directions->contains(MessageDirection::Outbound)
                && $directions->filter(fn (MessageDirection $direction): bool => $direction === MessageDirection::Inbound)->count() >= 2;
        });

        $this->assertGreaterThanOrEqual(2, $backAndForth->count());
    }

    /**
     * @return void
     */
    public function test_attachments_sit_on_the_first_message_of_the_four_named_cases(): void
    {
        $byCase = [];

        foreach (Attachment::query()->with('caseMessage.case')->get() as $attachment) {
            $byCase[$attachment->caseMessage->case->number][] = $attachment->filename;
            $this->assertSame(
                $attachment->caseMessage->case->messages()->firstOrFail()->id,
                $attachment->case_message_id,
                $attachment->filename,
            );
        }

        ksort($byCase);

        $this->assertSame([
            'CASE-0011' => [FixtureFile::FurnaceFilterInvoice->value],
            'CASE-0014' => [FixtureFile::KitchenSinkLeak->value],
            'CASE-0015' => [FixtureFile::SnowClearingQuote->value],
            'CASE-0016' => [FixtureFile::ThermostatError->value],
        ], $byCase);
    }

    /**
     * @return void
     */
    public function test_every_attachment_file_exists_with_its_recorded_size_and_type(): void
    {
        $directory = config('casefile.attachments.directory');
        $rows = Attachment::query()->get()->concat(MailboxAttachment::query()->get());

        $this->assertCount(8, $rows);

        foreach ($rows as $row) {
            $fixture = FixtureFile::from($row->storage_path);
            $path = $directory.DIRECTORY_SEPARATOR.$row->storage_path;

            $this->assertSame(basename($row->storage_path), $row->storage_path);
            $this->assertFileExists($path);
            $this->assertSame(File::size($path), $row->size_bytes, $row->storage_path);
            $this->assertSame($fixture->mimeType(), $row->mime_type, $row->storage_path);
            $this->assertSame($fixture->value, $row->filename);
        }
    }

    /**
     * @return void
     */
    public function test_every_case_message_has_a_matching_mailbox_row(): void
    {
        $messages = CaseMessage::query()->with(['mailboxMessage.attachments', 'attachments'])->get();

        $this->assertSame($messages->count(), MailboxMessage::query()->whereHas('caseMessage')->count());

        foreach ($messages as $message) {
            $mailbox = $message->mailboxMessage;

            $this->assertNotNull($mailbox, $message->gmail_message_id);
            $this->assertSame(
                [$message->gmail_message_id, $message->thread_id, $message->from_email, $message->from_name, $message->to_email, $message->subject, $message->body_text],
                [$mailbox->gmail_message_id, $mailbox->thread_id, $mailbox->from_email, $mailbox->from_name, $mailbox->to_email, $mailbox->subject, $mailbox->body_text],
            );
            $this->assertTrue($mailbox->received_at->equalTo($message->sent_at), $message->gmail_message_id);
            $this->assertFalse($mailbox->is_notification);
            $this->assertSame(
                match ($message->direction) {
                    MessageDirection::Inbound => MailboxLabel::Inbox,
                    MessageDirection::Outbound => MailboxLabel::Sent,
                },
                $mailbox->label,
            );
            $this->assertSame($message->attachments->pluck('filename')->all(), $mailbox->attachments->pluck('filename')->all());
            $this->assertLessThanOrEqual(160, mb_strlen($mailbox->snippet));
            $this->assertStringStartsWith(mb_substr($mailbox->snippet, 0, 40), preg_replace('/\s+/', ' ', $mailbox->body_text));
        }
    }

    /**
     * @return void
     */
    public function test_the_inbox_also_holds_untracked_mail_and_two_notifications(): void
    {
        $loose = MailboxMessage::query()->whereDoesntHave('caseMessage')->orderBy('id')->get();

        $this->assertSame(
            ['news@lakeshoreutilities.example', 'jade.okafor@mail.example', 'sam.whitfield@mail.example', 'notifications@casefile.example', 'notifications@casefile.example'],
            $loose->pluck('from_email')->all(),
        );

        foreach ($loose as $message) {
            $this->assertSame(MailboxLabel::Inbox, $message->label);
            $this->assertSame(config('casefile.owner.email'), $message->to_email);
            $this->assertFalse(CaseRecord::query()->where('thread_id', $message->thread_id)->exists(), $message->gmail_message_id);
            $this->assertSame($message->from_email === 'notifications@casefile.example', $message->is_notification);
        }

        $this->assertFalse(TrackedSender::query()->whereIn('email', ['news@lakeshoreutilities.example', 'sam.whitfield@mail.example', 'notifications@casefile.example'])->exists());
        $this->assertSame(
            ['New case CASE-0015: Snow clearing quote for the winter', 'New case CASE-0016: Boiler not firing, unit 2B'],
            $loose->where('is_notification', true)->pluck('subject')->values()->all(),
        );

        foreach ($loose->where('is_notification', true) as $notification) {
            $case = CaseRecord::query()->where('number', substr($notification->subject, 9, 9))->firstOrFail();

            $this->assertStringContainsString($case->number, $notification->body_text);
            $this->assertStringContainsString($case->sender_name.' ('.$case->sender_email.')', $notification->body_text);
            $this->assertStringContainsString('Subject: '.$case->subject, $notification->body_text);
            $this->assertDoesNotMatchRegularExpression('/:[a-z]/', $notification->subject.$notification->body_text);
            $this->assertTrue($notification->received_at->greaterThan($case->received_at));
        }
    }

    /**
     * @return void
     */
    public function test_mailbox_cursor_marks_the_seeded_mail_as_already_read(): void
    {
        $meta = InstallationMeta::query()->sole();

        $this->assertSame((string) MailboxMessage::query()->max('id'), $meta->mailbox_cursor);
        $this->assertSame(0, MailboxMessage::query()->where('id', '>', (int) $meta->mailbox_cursor)->count());
    }

    /**
     * @return void
     */
    public function test_eight_deliveries_in_positions_one_to_eight_exercise_every_intake_rule_in_order(): void
    {
        $deliveries = ScriptEntry::query()->where('kind', ScriptEntryKind::Delivery)->orderBy('position')->get();

        $this->assertSame(range(1, 8), $deliveries->pluck('position')->all());

        $outcomes = [];

        foreach ($deliveries as $delivery) {
            $payload = $delivery->payload;

            $this->assertNull($delivery->delivered_at);
            $this->assertSame(['from', 'subject', 'body_text', 'thread_id', 'attachments'], array_keys($payload));
            $this->assertSame($delivery->thread_id, $payload['thread_id']);

            $sender = TrackedSender::query()->where('email', SenderAddress::fromHeader($payload['from'])->email)->first();
            $case = CaseRecord::query()->where('thread_id', $payload['thread_id'])->first();

            if ($case !== null) {
                $this->assertSame('Re: '.$case->subject, $payload['subject']);
            }

            $outcomes[] = match (true) {
                $sender === null || ! $sender->is_active => 'ignored',
                $case === null => 'created',
                $case->status === CaseStatus::Closed => 'reopened',
                default => 'appended',
            };
        }

        $this->assertSame(['created', 'appended', 'ignored', 'created', 'reopened', 'created', 'appended', 'created'], $outcomes);

        $summary = $deliveries->map(fn (ScriptEntry $entry): array => [
            SenderAddress::fromHeader($entry->payload['from'])->email,
            $entry->payload['subject'],
            CaseRecord::query()->where('thread_id', $entry->thread_id)->value('number'),
            array_column($entry->payload['attachments'], 'filename'),
        ])->all();

        $this->assertSame([
            ['marcus.leblanc@mail.example', 'Bathroom fan rattling, unit 3A', null, []],
            ['priya.nair@mail.example', 'Re: Boiler not firing, unit 2B', 'CASE-0016', []],
            ['news@lakeshoreutilities.example', 'Get your home ready for the heating season', null, []],
            ['hello@northwaypm.example', 'Eavestrough cleaning estimate', null, [FixtureFile::SnowClearingQuote->value]],
            ['service@dufferinplumbing.example', 'Re: Invoice 2291: furnace filter and service', 'CASE-0011', []],
            ['service@dufferinplumbing.example', 'Hot water tank inspection', null, []],
            ['marcus.leblanc@mail.example', 'Re: Kitchen sink leaking, unit 3A', 'CASE-0014', []],
            ['priya.nair@mail.example', 'Front door closer', null, []],
        ], $summary);

        $newThreads = $deliveries->filter(fn (ScriptEntry $entry): bool => ! CaseRecord::query()->where('thread_id', $entry->thread_id)->exists())->pluck('thread_id');

        $this->assertSame($newThreads->unique()->count(), $newThreads->count());
        $this->assertFalse(MailboxMessage::query()->whereIn('thread_id', $newThreads)->exists());
        $this->assertSame(CaseStatus::InProgress, CaseRecord::query()->where('number', 'CASE-0014')->value('status'));
    }

    /**
     * @return void
     */
    public function test_a_scripted_reply_exists_for_every_open_case_new_script_thread_and_reopened_case(): void
    {
        $replies = ScriptEntry::query()->where('kind', ScriptEntryKind::ScriptedReply)->get();
        $openThreads = CaseRecord::query()->where('status', '!=', CaseStatus::Closed)->pluck('thread_id');
        $trackedDeliveries = ScriptEntry::query()
            ->where('kind', ScriptEntryKind::Delivery)
            ->get()
            ->filter(function (ScriptEntry $entry): bool {
                $sender = TrackedSender::query()->where('email', SenderAddress::fromHeader($entry->payload['from'])->email)->first();

                return $sender !== null && $sender->is_active;
            });
        $newThreads = $trackedDeliveries
            ->filter(fn (ScriptEntry $entry): bool => ! CaseRecord::query()->where('thread_id', $entry->thread_id)->exists())
            ->pluck('thread_id');
        $reopenedThreads = $trackedDeliveries
            ->filter(fn (ScriptEntry $entry): bool => CaseRecord::query()->where('thread_id', $entry->thread_id)->where('status', CaseStatus::Closed)->exists())
            ->pluck('thread_id');

        $this->assertCount(7, $openThreads);
        $this->assertCount(4, $newThreads);
        $this->assertSame(['thread-0011'], $reopenedThreads->values()->all());
        $this->assertCount(12, $replies);
        $this->assertEqualsCanonicalizing($openThreads->concat($newThreads)->concat($reopenedThreads)->all(), $replies->pluck('thread_id')->all());

        foreach ($replies as $reply) {
            $this->assertNull($reply->position);
            $this->assertNull($reply->delivered_at);
            $this->assertSame(['thread_id', 'from', 'body_text', 'attachments'], array_keys($reply->payload));
            $this->assertSame($reply->thread_id, $reply->payload['thread_id']);

            $case = CaseRecord::query()->where('thread_id', $reply->thread_id)->first();
            $expectedFrom = $case === null
                ? SenderAddress::fromHeader(ScriptEntry::query()->where('kind', ScriptEntryKind::Delivery)->where('thread_id', $reply->thread_id)->sole()->payload['from'])->email
                : $case->sender_email;

            $this->assertSame($expectedFrom, SenderAddress::fromHeader($reply->payload['from'])->email, $reply->thread_id);
        }
    }

    /**
     * @return void
     */
    public function test_sequence_continues_at_seventeen(): void
    {
        $this->assertSame(17, CaseNumberSequence::query()->sole()->next_number);
        $this->assertSame('CASE-0017', (new AllocateCaseNumber)());
    }

    /**
     * @return void
     */
    public function test_installation_meta_records_the_schema_and_the_seeding_time(): void
    {
        $meta = InstallationMeta::query()->sole();
        $migrations = array_map(fn (string $path): string => basename($path, '.php'), File::glob(database_path('migrations/*.php')));
        sort($migrations);

        $this->assertSame(end($migrations), $meta->schema_version);
        $this->assertTrue($meta->seeded_at->between(CarbonImmutable::now()->subMinute(), CarbonImmutable::now()));
        $this->assertSame(config('app.timezone'), $meta->seeded_at->timezoneName);
        $this->assertNull($meta->dates_shifted_to);
    }

    /**
     * @return void
     */
    public function test_events_record_each_case_history(): void
    {
        $seededAt = InstallationMeta::query()->sole()->seeded_at;

        foreach (CaseRecord::query()->with('messages')->get() as $case) {
            $events = $case->events()->orderBy('occurred_at')->orderBy('id')->get();
            $inbound = $case->messages->where('direction', MessageDirection::Inbound)->count();
            $outbound = $case->messages->where('direction', MessageDirection::Outbound)->count();

            $this->assertSame(CaseEventKind::Created, $events->first()->kind, $case->number);
            $this->assertTrue($events->first()->occurred_at->equalTo($case->received_at), $case->number);
            $this->assertSame(1, $events->where('kind', CaseEventKind::Created)->count(), $case->number);
            $this->assertSame($inbound - 1, $events->where('kind', CaseEventKind::MessageReceived)->count(), $case->number);
            $this->assertSame($outbound, $events->where('kind', CaseEventKind::ReplySent)->count(), $case->number);
            $this->assertSame(0, $events->where('kind', CaseEventKind::Reopened)->count(), $case->number);

            $status = CaseStatus::Open;
            $lastChange = null;

            foreach ($events->where('kind', CaseEventKind::StatusChanged) as $change) {
                $this->assertSame($status, $change->from_status, $case->number);
                $this->assertNotSame($change->from_status, $change->to_status, $case->number);
                $status = $change->to_status;
                $lastChange = $change->occurred_at;
            }

            $this->assertSame($status, $case->status, $case->number);
            $this->assertTrue($events->last()->occurred_at->lessThanOrEqualTo($seededAt), $case->number);

            if ($case->status === CaseStatus::Closed) {
                $this->assertNotNull($case->closed_at, $case->number);
                $this->assertTrue($case->closed_at->equalTo($lastChange), $case->number);
                $this->assertTrue($case->closed_at->greaterThanOrEqualTo($case->messages->last()->sent_at), $case->number);
            } else {
                $this->assertNull($case->closed_at, $case->number);
            }
        }
    }

    /**
     * @return void
     */
    public function test_every_seeded_address_parses_and_sits_on_an_example_domain(): void
    {
        $inbox = $this->seedData('inbox');
        $script = $this->seedData('script');
        $headers = array_merge(
            array_column($this->seedData('senders'), 'header'),
            array_column($this->seedData('cases'), 'sender'),
            array_column($inbox['messages'], 'from'),
            [$inbox['notifications']['from'], config('casefile.owner.email')],
            array_column($script['deliveries'], 'from'),
            array_column($script['replies'], 'from'),
        );

        $this->assertCount(5 + 16 + 3 + 2 + 8 + 12, $headers);

        foreach ($headers as $header) {
            $this->assertStringEndsWith('.example', SenderAddress::fromHeader($header)->email, $header);
        }

        foreach (array_column($this->seedData('senders'), 'header') as $header) {
            $this->assertTrue(TrackedSender::query()->where('email', SenderAddress::fromHeader($header)->email)->exists(), $header);
        }

        $stored = MailboxMessage::query()->pluck('from_email')
            ->concat(MailboxMessage::query()->pluck('to_email'))
            ->concat(CaseMessage::query()->pluck('from_email'))
            ->concat(CaseMessage::query()->pluck('to_email'))
            ->concat(TrackedSender::query()->pluck('email'));

        foreach ($stored as $email) {
            $this->assertMatchesRegularExpression('/^[a-z0-9.]+@[a-z0-9.]+\.example$/D', $email);
        }
    }

    /**
     * @return void
     */
    public function test_every_script_attachment_references_an_existing_fixture_file(): void
    {
        $attachments = ScriptEntry::query()->get()->flatMap(fn (ScriptEntry $entry): array => $entry->payload['attachments']);

        $this->assertCount(1, $attachments);

        foreach ($attachments as $attachment) {
            $this->assertSame(['filename', 'mime_type', 'size_bytes'], array_keys($attachment));

            $fixture = FixtureFile::from($attachment['filename']);

            $this->assertFileExists($fixture->path());
            $this->assertSame(File::size($fixture->path()), $attachment['size_bytes']);
            $this->assertSame($fixture->mimeType(), $attachment['mime_type']);
        }

        foreach (FixtureFile::cases() as $fixture) {
            $this->assertFileExists($fixture->path());
        }
    }

    /**
     * @return void
     */
    public function test_correspondence_is_plain_ascii_with_three_to_eight_sentences(): void
    {
        $bodies = MailboxMessage::query()->where('is_notification', false)->pluck('body_text')
            ->concat(ScriptEntry::query()->get()->map(fn (ScriptEntry $entry): string => $entry->payload['body_text']));

        $this->assertSame(38, CaseMessage::query()->count());
        $this->assertCount(38 + 3 + 20, $bodies);

        foreach ($bodies as $body) {
            $this->assertMatchesRegularExpression('/^[\x20-\x7E\n]+$/D', $body);

            $sentences = preg_match_all('/[.!?](?=\s|$)/', $body);

            $this->assertGreaterThanOrEqual(3, $sentences, $body);
            $this->assertLessThanOrEqual(8, $sentences, $body);
        }

        $texts = CaseRecord::query()->pluck('subject')
            ->concat(CaseRecord::query()->whereNotNull('issue')->pluck('issue'))
            ->concat(CaseRecord::query()->whereNotNull('notes')->pluck('notes'))
            ->concat(MailboxMessage::query()->pluck('subject'));

        foreach ($texts as $text) {
            $this->assertMatchesRegularExpression('/^[\x20-\x7E]+$/D', $text);
        }
    }

    /**
     * @return void
     */
    public function test_seeded_text_names_no_date_clock_time_or_weekday(): void
    {
        $texts = MailboxMessage::query()->pluck('body_text')
            ->concat(MailboxMessage::query()->pluck('subject'))
            ->concat(CaseRecord::query()->pluck('subject'))
            ->concat(CaseRecord::query()->whereNotNull('issue')->pluck('issue'))
            ->concat(CaseRecord::query()->whereNotNull('notes')->pluck('notes'))
            ->concat(ScriptEntry::query()->get()->map(fn (ScriptEntry $entry): string => $entry->payload['body_text']))
            ->concat(ScriptEntry::query()->where('kind', ScriptEntryKind::Delivery)->get()->map(fn (ScriptEntry $entry): string => $entry->payload['subject']));

        $this->assertCount(43 + 43 + 16 + 15 + 14 + 20 + 8, $texts);

        foreach ($texts as $text) {
            foreach (self::TIME_BOUND_WORDING as $kind => $pattern) {
                $this->assertDoesNotMatchRegularExpression($pattern, $text, $kind);
            }
        }
    }

    /**
     * @return array<string, array{string}>
     */
    public static function timeBoundPhrases(): array
    {
        return [
            'woke up at an hour' => ['I woke up at 5 because it was cold.'],
            'until almost an hour' => ['It went on until almost 3.'],
            'around an hour' => ['I heard him come in around 1.'],
            'until an hour' => ['The music went on until 3.'],
            'last night' => ['The heat stopped last night.'],
            'this weekend' => ['Could I borrow the ladder this weekend?'],
            'next weekend' => ['We can do it next weekend.'],
            'numeric month and day' => ['Paid on 10/14.'],
            'numeric day and month' => ['Paid on 14/10.'],
            'numeric date before in the morning' => ['Booked for 10/14 in the morning.'],
            'numeric date before in full' => ['Paid 10/14 in full.'],
            'fraction-like date before in' => ['Booked for 3/4 in the morning.'],
            'numeric dates on days thirty and thirty-one' => ['Paid on 12/31 or 31/12.'],
            'clock with minutes' => ['Around 9:30 the heat stopped.'],
            'clock with pm' => ['Come by at 7 pm.'],
            'clock with glued am' => ['Booked for 10am.'],
            'clock with dotted pm' => ['Booked for 4 p.m. sharp.'],
            'o clock' => ["Let's say 2 o'clock."],
            'weekday' => ['Could we meet next Tuesday?'],
            'weekday plural' => ['Saturdays work best.'],
            'abbreviated weekday' => ['Open Mon to Fri.'],
            'this afternoon' => ['I spoke with him this afternoon.'],
            'tonight' => ['I will call tonight.'],
            'month and day' => ['The visit is on October 9.'],
            'short month and day' => ['Paid on Oct 14.'],
            'dotted month and day' => ['Paid on Oct. 14.'],
            'day and month' => ['Paid on 14 October.'],
            'ordinal day' => ['Rent is due on the 14th.'],
            'year' => ['Since the spring of 2026.'],
        ];
    }

    /**
     * @param  string  $phrase
     * @return void
     */
    #[DataProvider('timeBoundPhrases')]
    public function test_the_time_bound_guard_catches_dates_clock_times_and_weekdays(string $phrase): void
    {
        $caught = array_filter(self::TIME_BOUND_WORDING, fn (string $pattern): bool => preg_match($pattern, $phrase) === 1);

        $this->assertNotEmpty($caught, $phrase);
    }

    /**
     * @return void
     */
    public function test_the_time_bound_guard_allows_relative_wording_and_ordinary_numbers(): void
    {
        foreach ([
            'I am home most evenings after 6 if someone needs to come in.',
            'A start after 10 would be kind to him.',
            'We have you booked for later this week, between 8 and 10 in the morning.',
            'He will keep things quiet after 11.',
            'I have booked Dufferin Plumbing for tomorrow between 9 and 11.',
            'I am usually up by 2 in the afternoon.',
            'Any time between 2 and 5 works if someone needs to come up.',
            'We fitted a 3/4 inch valve on the main.',
            'The 1/2-inch line under the sink is fine.',
            'Call our 24/7 emergency line.',
            'It needs a 3/4 inches fitting.',
            'Close the 1/2 cm gap.',
            'Slide in a 1/2 mm shim.',
            'Cut a 3/4 ft board.',
            'Add a 1/2 foot step.',
            'Allow a 3/4 feet drop.',
            'The water would be off from about 9 to 11.',
            'Booked for tomorrow between 9 and 11 in the morning.',
            'Unit 1A, filter 16x25x1, MERV 8.',
            'Invoice 2291 comes to $1,480.00 plus HST.',
            'The pump may need replacing earlier than we thought.',
            'I saw her earlier today and will come by later this week.',
            'A morning early next week works, or in a few days.',
            'System pressure reads 12 psi at the boiler.',
        ] as $phrase) {
            foreach (self::TIME_BOUND_WORDING as $kind => $pattern) {
                $this->assertDoesNotMatchRegularExpression($pattern, $phrase, $kind);
            }
        }
    }
}
