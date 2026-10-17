<?php

namespace Tests\Feature;

use App\Contracts\MailboxConnector;
use App\Intake\TrackedSenderBackfill;
use App\Models\CaseNumberSequence;
use App\Models\CaseRecord;
use App\Models\InstallationMeta;
use App\Models\MailboxMessage;
use App\Models\TrackedSender;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class TrackedSenderBackfillTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
    }

    /**
     * @return void
     */
    public function test_activation_backfills_full_threads_oldest_first_and_a_second_run_creates_nothing(): void
    {
        $sender = TrackedSender::factory()->create(['email' => 'backfill@mail.example', 'is_active' => false]);
        $cursor = InstallationMeta::query()->sole()->mailbox_cursor;

        foreach ([1, 3, 2] as $daysAgo) {
            MailboxMessage::factory()->create([
                'thread_id' => 'backfill-'.$daysAgo,
                'from_email' => 'Backfill Sender <BACKFILL@MAIL.EXAMPLE>',
                'received_at' => CarbonImmutable::now()->subDays($daysAgo),
            ]);
        }

        $reply = MailboxMessage::factory()->create([
            'thread_id' => 'backfill-3',
            'from_email' => $sender->email,
            'received_at' => CarbonImmutable::now()->subHours(3),
        ]);
        MailboxMessage::factory()->create(['thread_id' => 'backfill-unrelated', 'from_email' => 'unrelated@mail.example']);
        MailboxMessage::factory()->create(['thread_id' => 'backfill-notification', 'from_email' => $sender->email, 'is_notification' => true]);
        $backfill = app(TrackedSenderBackfill::class);
        $this->assertSame(0, $backfill->run($sender));
        $sender->fill(['is_active' => true])->save();

        $this->assertSame(3, $backfill->run($sender));
        $cases = CaseRecord::query()->where('tracked_sender_id', $sender->id)->orderBy('number')->get();
        $this->assertSame(['CASE-0017', 'CASE-0018', 'CASE-0019'], $cases->pluck('number')->all());
        $this->assertSame(['backfill-3', 'backfill-2', 'backfill-1'], $cases->pluck('thread_id')->all());
        $this->assertSame(2, $cases[0]->messages()->count());
        $this->assertSame($reply->gmail_message_id, $cases[0]->messages()->get()->last()->gmail_message_id);
        $this->assertSame(0, $backfill->run($sender));
        $this->assertSame(19, CaseRecord::query()->count());
        $this->assertSame($cursor, InstallationMeta::query()->sole()->mailbox_cursor);
    }

    /**
     * @return void
     */
    public function test_existing_case_threads_are_excluded_even_when_a_new_matching_message_exists(): void
    {
        $sender = TrackedSender::query()->where('email', 'priya.nair@mail.example')->sole();
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $messages = $case->messages()->count();
        MailboxMessage::factory()->create(['thread_id' => $case->thread_id, 'from_email' => $sender->email]);

        $this->assertSame(0, app(TrackedSenderBackfill::class)->run($sender));
        $this->assertSame($messages, $case->messages()->count());
    }

    /**
     * @param  string  $leadingHeader
     * @return void
     */
    #[DataProvider('ignoredLeadingHeaders')]
    public function test_ignored_leading_mail_does_not_move_later_accepted_mail_ahead_of_another_thread(string $leadingHeader): void
    {
        $sender = TrackedSender::factory()->create(['email' => 'ordering@mail.example']);
        $cursor = InstallationMeta::query()->sole()->mailbox_cursor;
        $base = CarbonImmutable::now()->startOfSecond();
        $leading = MailboxMessage::factory()->create([
            'thread_id' => 'ordering-a',
            'from_email' => $leadingHeader,
            'received_at' => $base->subDays(5),
        ]);
        $firstAcceptedInA = MailboxMessage::factory()->create([
            'thread_id' => 'ordering-a',
            'from_email' => $sender->email,
            'received_at' => $base->subDays(3),
        ]);
        $firstAcceptedInB = MailboxMessage::factory()->create([
            'thread_id' => 'ordering-b',
            'from_email' => 'Ordering Sender <ORDERING@MAIL.EXAMPLE>',
            'received_at' => $base->subDays(4),
        ]);
        $replyInA = MailboxMessage::factory()->create([
            'thread_id' => 'ordering-a',
            'from_email' => $sender->email,
            'received_at' => $base->subDay(),
        ]);
        $replyInB = MailboxMessage::factory()->create([
            'thread_id' => 'ordering-b',
            'from_email' => $sender->email,
            'received_at' => $base->subDays(2),
        ]);
        $pull = app(MailboxConnector::class)->backfill(new SenderAddress(email: $sender->email, name: $sender->name));
        $expectedMessageIds = [$firstAcceptedInB->id, $firstAcceptedInA->id, $replyInB->id, $replyInA->id];

        if ($leadingHeader !== 'invalid <') {
            array_unshift($expectedMessageIds, $leading->id);
        }

        $this->assertSame($expectedMessageIds, array_column($pull->messages, 'mailboxMessageId'));
        $backfill = app(TrackedSenderBackfill::class);

        $this->assertSame(2, $backfill->run($sender));
        $cases = CaseRecord::query()->where('tracked_sender_id', $sender->id)->orderBy('number')->get();
        $this->assertSame(['CASE-0017', 'CASE-0018'], $cases->pluck('number')->all());
        $this->assertSame(['ordering-b', 'ordering-a'], $cases->pluck('thread_id')->all());
        $this->assertTrue($cases[0]->received_at->equalTo($firstAcceptedInB->received_at));
        $this->assertTrue($cases[1]->received_at->equalTo($firstAcceptedInA->received_at));
        $this->assertSame([$firstAcceptedInB->id, $replyInB->id], $cases[0]->messages()->pluck('mailbox_message_id')->all());
        $this->assertSame([$firstAcceptedInA->id, $replyInA->id], $cases[1]->messages()->pluck('mailbox_message_id')->all());
        $this->assertDatabaseMissing('case_messages', ['mailbox_message_id' => $leading->id]);
        $this->assertSame(0, $backfill->run($sender));
        $this->assertSame(18, CaseRecord::query()->count());
        $this->assertSame(19, CaseNumberSequence::query()->sole()->next_number);
        $this->assertSame($cursor, InstallationMeta::query()->sole()->mailbox_cursor);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function ignoredLeadingHeaders(): array
    {
        return [
            'unknown sender' => ['unknown@mail.example'],
            'inactive sender' => ['jade.okafor@mail.example'],
            'malformed sender' => ['invalid <'],
        ];
    }

    /**
     * @return void
     */
    public function test_equal_received_times_preserve_id_order_across_selected_threads(): void
    {
        $sender = TrackedSender::factory()->create(['email' => 'equal-time@mail.example']);
        $receivedAt = CarbonImmutable::now()->subDay()->startOfSecond();

        foreach (['equal-time-z', 'equal-time-a'] as $threadId) {
            MailboxMessage::factory()->create([
                'thread_id' => $threadId,
                'from_email' => $sender->email,
                'received_at' => $receivedAt,
            ]);
        }

        $this->assertSame(2, app(TrackedSenderBackfill::class)->run($sender));
        $this->assertSame(['equal-time-z', 'equal-time-a'], CaseRecord::query()->where('tracked_sender_id', $sender->id)->orderBy('number')->pluck('thread_id')->all());
    }
}
