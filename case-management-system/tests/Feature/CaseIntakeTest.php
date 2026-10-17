<?php

namespace Tests\Feature;

use App\Contracts\MailboxConnector;
use App\Data\IncomingAttachment;
use App\Data\IncomingMessage;
use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\IntakeResult;
use App\Enums\MailboxLabel;
use App\Intake\CaseIntake;
use App\Models\CaseMessage;
use App\Models\CaseNumberSequence;
use App\Models\CaseRecord;
use App\Models\MailboxMessage;
use App\Models\TrackedSender;
use App\Models\User;
use App\Notifications\CaseCreated;
use App\Notifications\CaseReopened;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use RuntimeException;
use Tests\TestCase;

class CaseIntakeTest extends TestCase
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
    public function test_unknown_and_inactive_senders_are_ignored_before_thread_lookup(): void
    {
        $intake = app(CaseIntake::class);
        $cases = CaseRecord::query()->count();
        $messages = CaseMessage::query()->count();
        $owner = User::query()->sole();
        $notifications = $owner->notifications()->count();
        $mailbox = MailboxMessage::query()->count();

        foreach ([
            $this->incoming(header: 'stranger@mail.example'),
            $this->incoming(header: 'jade.okafor@mail.example'),
            $this->incoming(header: 'jade.okafor@mail.example', threadId: 'thread-0016'),
        ] as $message) {
            $this->assertSame(IntakeResult::Ignored, $intake->ingest($message)->result);
        }

        $this->assertSame($cases, CaseRecord::query()->count());
        $this->assertSame($messages, CaseMessage::query()->count());
        $this->assertSame($notifications, $owner->notifications()->count());
        $this->assertSame($mailbox, MailboxMessage::query()->count());
        $this->assertSame(17, CaseNumberSequence::query()->sole()->next_number);
    }

    /**
     * @return void
     */
    public function test_tracked_header_creates_case_with_original_timestamp_attachment_and_both_notifications(): void
    {
        $mailbox = MailboxMessage::factory()->create();
        $incoming = $this->incoming(header: '  Priya Nair <PRIYA.NAIR@Mail.Example>  ', mailboxMessageId: $mailbox->id);
        $outcome = app(CaseIntake::class)->ingest($incoming);

        $this->assertSame(IntakeResult::Created, $outcome->result);
        $this->assertSame('CASE-0017', $outcome->case->number);
        $this->assertSame('priya.nair@mail.example', $outcome->case->sender_email);
        $this->assertSame('Priya Nair', $outcome->case->sender_name);
        $this->assertTrue($outcome->case->received_at->equalTo($incoming->receivedAt));
        $this->assertTrue($outcome->message->sent_at->equalTo($incoming->receivedAt));
        $this->assertSame($mailbox->id, $outcome->message->mailbox_message_id);
        $this->assertSame('quote.pdf', $outcome->message->attachments()->sole()->storage_path);
        $this->assertSame(CaseEventKind::Created, $outcome->case->events()->sole()->kind);
        $notification = User::query()->sole()->notifications()->where('type', CaseCreated::class)->get()->firstWhere('data.number', 'CASE-0017');
        $this->assertNotNull($notification);
        $this->assertSame([
            'case_id' => $outcome->case->id,
            'number' => 'CASE-0017',
            'subject' => 'New intake issue',
            'result' => IntakeResult::Created->value,
        ], $notification->data);
        $this->assertDatabaseHas('mailbox_messages', [
            'label' => MailboxLabel::Inbox->value,
            'is_notification' => true,
            'subject' => 'New case CASE-0017: New intake issue',
        ]);
    }

    /**
     * @return void
     */
    public function test_open_thread_appends_once_and_records_message_received_without_allocating_or_notifying(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $count = $case->messages()->count();
        $notifications = User::query()->sole()->notifications()->count();
        $incoming = $this->incoming(threadId: $case->thread_id);
        $intake = app(CaseIntake::class);
        $outcome = $intake->ingest($incoming);

        $this->assertSame(IntakeResult::Appended, $outcome->result);
        $this->assertSame($case->id, $outcome->case->id);
        $this->assertSame($count + 1, $case->messages()->count());
        $this->assertDatabaseHas('case_events', ['case_id' => $case->id, 'kind' => CaseEventKind::MessageReceived->value]);
        $this->assertSame(IntakeResult::Ignored, $intake->ingest($incoming)->result);
        $this->assertSame($count + 1, $case->messages()->count());
        $this->assertSame(1, $case->events()->where('kind', CaseEventKind::MessageReceived)->count());
        $this->assertSame(17, CaseNumberSequence::query()->sole()->next_number);
        $this->assertSame($notifications, User::query()->sole()->notifications()->count());
    }

    /**
     * @return void
     */
    public function test_closed_thread_reopens_once_and_keeps_number_and_received_date(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0011')->sole();
        $receivedAt = $case->received_at;
        $incoming = $this->incoming(header: 'service@dufferinplumbing.example', threadId: $case->thread_id);
        $outcome = app(CaseIntake::class)->ingest($incoming);

        $this->assertSame(IntakeResult::Reopened, $outcome->result);
        $this->assertSame('CASE-0011', $outcome->case->number);
        $this->assertSame(CaseStatus::Open, $case->refresh()->status);
        $this->assertNull($case->closed_at);
        $this->assertTrue($case->received_at->equalTo($receivedAt));
        $this->assertSame(1, $case->events()->where('kind', CaseEventKind::Reopened)->count());
        $event = $case->events()->where('kind', CaseEventKind::Reopened)->sole();
        $this->assertSame(CaseStatus::Closed, $event->from_status);
        $this->assertSame(CaseStatus::Open, $event->to_status);
        $this->assertTrue($event->occurred_at->equalTo($incoming->receivedAt));
        $this->assertSame(1, User::query()->sole()->notifications()->where('type', CaseReopened::class)->count());
        $this->assertDatabaseHas('mailbox_messages', ['label' => MailboxLabel::Inbox->value, 'subject' => 'Case CASE-0011 reopened: '.$case->subject]);
        $this->assertSame(IntakeResult::Ignored, app(CaseIntake::class)->ingest($incoming)->result);
        $this->assertSame(1, $case->events()->where('kind', CaseEventKind::Reopened)->count());
        $this->assertSame(17, CaseNumberSequence::query()->sole()->next_number);
    }

    /**
     * @return void
     */
    public function test_created_message_is_idempotent_even_after_case_is_closed(): void
    {
        $incoming = $this->incoming();
        $intake = app(CaseIntake::class);
        $first = $intake->ingest($incoming);
        $first->case->fill(['status' => CaseStatus::Closed, 'closed_at' => CarbonImmutable::now()])->save();
        $this->assertSame(IntakeResult::Ignored, $intake->ingest($incoming)->result);
        $this->assertSame(CaseStatus::Closed, $first->case->refresh()->status);
        $this->assertSame(1, $first->case->messages()->count());
        $this->assertSame(1, $first->case->events()->count());
        $this->assertSame(18, CaseNumberSequence::query()->sole()->next_number);
    }

    /**
     * @return void
     */
    public function test_notification_flags_and_internal_addresses_cannot_open_cases_when_tracked(): void
    {
        foreach ([config('casefile.notifications.email'), config('casefile.owner.email')] as $email) {
            TrackedSender::factory()->create(['email' => $email]);
            $this->assertSame(IntakeResult::Ignored, app(CaseIntake::class)->ingest($this->incoming(header: $email))->result);
        }

        $this->assertSame(IntakeResult::Ignored, app(CaseIntake::class)->ingest($this->incoming(isNotification: true))->result);
        $this->assertSame(16, CaseRecord::query()->count());
        $this->assertSame(17, CaseNumberSequence::query()->sole()->next_number);
    }

    /**
     * @return void
     */
    public function test_notification_delivery_failure_rolls_back_case_number_messages_events_and_database_notification(): void
    {
        $connector = Mockery::mock(MailboxConnector::class);
        $connector->shouldReceive('send')->once()->andThrow(new RuntimeException('Mailbox unavailable.'));
        $this->app->instance(MailboxConnector::class, $connector);
        $messages = CaseMessage::query()->count();
        $notifications = User::query()->sole()->notifications()->count();

        try {
            app(CaseIntake::class)->ingest($this->incoming());
            $this->fail('Expected notification delivery to fail.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Mailbox unavailable.', $exception->getMessage());
        }

        $this->assertSame(16, CaseRecord::query()->count());
        $this->assertSame(17, CaseNumberSequence::query()->sole()->next_number);
        $this->assertSame($messages, CaseMessage::query()->count());
        $this->assertSame($notifications, User::query()->sole()->notifications()->count());
        $this->assertDatabaseMissing('case_events', ['case_id' => 17]);
    }

    /**
     * @param  string  $header
     * @param  string  $threadId
     * @param  ?int  $mailboxMessageId
     * @param  bool  $isNotification
     * @return IncomingMessage
     */
    private function incoming(
        string $header = 'priya.nair@mail.example',
        string $threadId = 'thread-intake-new',
        ?int $mailboxMessageId = null,
        bool $isNotification = false,
    ): IncomingMessage {
        return new IncomingMessage(
            gmailMessageId: 'intake-message-'.$threadId,
            threadId: $threadId,
            from: SenderAddress::fromHeader($header),
            toEmail: config('casefile.owner.email'),
            subject: 'New intake issue',
            bodyText: 'The window latch is stuck.',
            receivedAt: CarbonImmutable::now()->subHours(2)->startOfSecond(),
            attachments: [new IncomingAttachment(filename: 'quote.pdf', mimeType: 'application/pdf', sizeBytes: 42, storagePath: 'quote.pdf')],
            mailboxMessageId: $mailboxMessageId,
            isNotification: $isNotification,
        );
    }
}
