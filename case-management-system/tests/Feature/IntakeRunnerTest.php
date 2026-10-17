<?php

namespace Tests\Feature;

use App\Enums\IntakeResult;
use App\Enums\MailboxLabel;
use App\Intake\IntakeRunner;
use App\Models\CaseMessage;
use App\Models\CaseNumberSequence;
use App\Models\CaseRecord;
use App\Models\InstallationMeta;
use App\Models\MailboxMessage;
use App\Models\TrackedSender;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

class IntakeRunnerTest extends TestCase
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
    public function test_pull_uses_received_order_and_highest_id_cursor_without_losing_or_repeating_rows(): void
    {
        $later = MailboxMessage::factory()->create([
            'from_email' => 'outsider@mail.example',
            'received_at' => CarbonImmutable::now()->subDay(),
        ]);
        $earlier = MailboxMessage::factory()->create([
            'from_email' => 'another@mail.example',
            'received_at' => CarbonImmutable::now()->subDays(2),
        ]);
        MailboxMessage::factory()->create(['label' => MailboxLabel::Sent]);
        $runner = app(IntakeRunner::class);
        $outcomes = $runner->run();

        $this->assertCount(2, $outcomes);
        $this->assertSame([IntakeResult::Ignored, IntakeResult::Ignored], array_column($outcomes, 'result'));
        $this->assertSame((string) $earlier->id, InstallationMeta::query()->sole()->mailbox_cursor);
        $this->assertSame([], $runner->run());
        $this->assertSame(16, CaseRecord::query()->count());
        $this->assertLessThan($earlier->id, $later->id);
    }

    /**
     * @return void
     */
    public function test_new_case_notifications_are_consumed_once_without_a_notification_loop(): void
    {
        TrackedSender::factory()->create(['email' => config('casefile.notifications.email')]);
        TrackedSender::factory()->create(['email' => config('casefile.owner.email')]);
        MailboxMessage::factory()->create(['from_email' => 'priya.nair@mail.example']);
        $runner = app(IntakeRunner::class);

        $this->assertSame(IntakeResult::Created, $runner->run()[0]->result);
        $outcomes = $runner->run();
        $this->assertCount(1, $outcomes);
        $this->assertSame(IntakeResult::Ignored, $outcomes[0]->result);
        $this->assertSame([], $runner->run());
        $this->assertSame(17, CaseRecord::query()->count());
        $this->assertSame(18, CaseNumberSequence::query()->sole()->next_number);
    }

    /**
     * @return void
     */
    public function test_malformed_sender_does_not_block_valid_mail_and_advances_cursor_with_observable_reason(): void
    {
        Log::spy();
        $valid = MailboxMessage::factory()->create(['from_email' => 'priya.nair@mail.example']);
        $invalid = MailboxMessage::factory()->create(['from_email' => 'broken <', 'received_at' => CarbonImmutable::now()->subYears(2)]);
        $outcomes = app(IntakeRunner::class)->run();

        $this->assertCount(2, $outcomes);
        $this->assertSame(IntakeResult::Created, $outcomes[0]->result);
        $this->assertSame(IntakeResult::Ignored, $outcomes[1]->result);
        $this->assertSame('Sender header has no valid address.', $outcomes[1]->reason);
        $this->assertSame((string) $invalid->id, InstallationMeta::query()->sole()->mailbox_cursor);
        $this->assertDatabaseHas('case_messages', ['mailbox_message_id' => $valid->id]);
        $this->assertFalse(CaseMessage::query()->where('mailbox_message_id', $invalid->id)->exists());
        Log::shouldHaveReceived('warning')->once()->with('Mailbox message ignored.', [
            'gmail_message_id' => $invalid->gmail_message_id,
            'reason' => 'Sender header has no valid address.',
        ]);
    }

    /**
     * @return void
     */
    public function test_seeded_cursor_skips_all_seeded_mail_and_unread_notifications_match_seeded_inbox(): void
    {
        $this->assertSame([], app(IntakeRunner::class)->run());
        $this->assertSame((string) MailboxMessage::query()->max('id'), InstallationMeta::query()->sole()->mailbox_cursor);
        $this->assertSame(16, CaseRecord::query()->count());
    }
}
