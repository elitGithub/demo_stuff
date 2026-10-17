<?php

namespace Tests\Feature;

use App\Contracts\MailboxConnector;
use App\Demo\InboxScript;
use App\Enums\CaseStatus;
use App\Enums\IntakeResult;
use App\Enums\MessageDirection;
use App\Enums\ScriptEntryKind;
use App\Intake\IntakeRunner;
use App\Mailbox\SimulatedMailbox;
use App\Models\CaseMessage;
use App\Models\CaseNumberSequence;
use App\Models\CaseRecord;
use App\Models\InstallationMeta;
use App\Models\MailboxAttachment;
use App\Models\MailboxMessage;
use App\Models\ScriptEntry;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Mockery;
use RuntimeException;
use Symfony\Component\Process\InputStream;
use Symfony\Component\Process\Process;
use Tests\Support\BuildsTemplateFile;
use Tests\TestCase;

class InboxScriptTest extends TestCase
{
    use BuildsTemplateFile;
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
    public function test_all_eight_deliveries_have_the_exact_outcomes_and_progress_excludes_replies(): void
    {
        $script = app(InboxScript::class);
        $this->assertEquals([0, 8, false], [$script->progress()->delivered, $script->progress()->total, $script->progress()->finished]);
        $expected = [IntakeResult::Created, IntakeResult::Appended, IntakeResult::Ignored, IntakeResult::Created, IntakeResult::Reopened, IntakeResult::Created, IntakeResult::Appended, IntakeResult::Created];
        $mailboxIds = [];

        foreach ($expected as $index => $result) {
            $report = $script->deliverNext();
            $this->assertNotNull($report);
            $this->assertSame($result, $report->outcome->result);
            $this->assertSame($report->mailboxMessage->gmail_message_id, $report->outcome->gmailMessageId);
            $this->assertSame($index + 1, $script->progress()->delivered);
            $mailboxIds[] = $report->mailboxMessage->id;

            if ($index === 0) {
                $this->assertSame('New case CASE-0017 from Marcus Leblanc', $report->summary);
            }

            if ($index === 1) {
                $this->assertSame('Added to CASE-0016', $report->summary);
            }

            if ($index === 2) {
                $this->assertSame('Ignored: news@lakeshoreutilities.example is not a tracked sender', $report->summary);
            }

            if ($index === 3) {
                $attachment = $report->outcome->message->attachments()->sole();
                $this->assertSame($attachment->filename, $attachment->storage_path);
                $this->assertSame(1, $report->mailboxMessage->attachments()->count());
                $this->assertSame('application/pdf', $attachment->mime_type);
                $this->assertGreaterThan(0, $attachment->size_bytes);
            }

            if ($index === 4) {
                $this->assertSame('Reopened CASE-0011', $report->summary);
            }
        }

        $this->assertCount(8, array_unique($mailboxIds));
        $this->assertNull($script->deliverNext());
        $this->assertTrue($script->progress()->finished);
        $this->assertSame(8, $script->progress()->total);
        $this->assertSame(0, ScriptEntry::query()->where('kind', ScriptEntryKind::ScriptedReply)->whereNotNull('delivered_at')->count());
    }

    /**
     * @return void
     */
    public function test_delivered_entries_are_skipped_and_never_replayed(): void
    {
        ScriptEntry::query()->where('kind', ScriptEntryKind::Delivery)->where('position', 2)->update(['delivered_at' => CarbonImmutable::now()]);
        $script = app(InboxScript::class);
        $threads = [];

        for ($attempt = 0; $attempt < 3; $attempt++) {
            $threads[] = $script->deliverNext()->mailboxMessage->thread_id;
        }

        $this->assertSame(['thread-script-01', 'thread-news-02', 'thread-script-04'], $threads);
        $this->assertSame(4, $script->progress()->delivered);
        $this->assertSame(0, MailboxMessage::query()->where('thread_id', 'thread-0016')->where('gmail_message_id', 'like', 'script-%')->count());
    }

    /**
     * @return void
     */
    public function test_report_correlates_created_appended_and_ignored_mail_among_unrelated_pending_rows(): void
    {
        $script = app(InboxScript::class);

        foreach ([IntakeResult::Created, IntakeResult::Appended, IntakeResult::Ignored] as $expected) {
            MailboxMessage::factory()->create(['is_notification' => true]);
            MailboxMessage::factory()->create(['from_email' => 'invalid <']);
            $report = $script->deliverNext();
            $this->assertSame($expected, $report->outcome->result);
            $this->assertSame($report->mailboxMessage->gmail_message_id, $report->outcome->gmailMessageId);
        }

        MailboxMessage::factory()->create(['from_email' => 'invalid <']);
        $rejected = app(IntakeRunner::class)->run();
        $this->assertCount(1, $rejected);
        $this->assertSame(MailboxMessage::query()->latest('id')->first()->gmail_message_id, $rejected[0]->gmailMessageId);
    }

    /**
     * @return void
     */
    public function test_reply_waits_for_its_pending_delivery_then_appends_once_with_case_subject(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $script = app(InboxScript::class);
        $this->assertNull($script->deliverReply(case: $case));
        $script->deliverNext();
        $this->assertNull($script->deliverReply(case: $case));
        $script->deliverNext();
        $count = $case->messages()->count();
        $report = $script->deliverReply(case: $case);

        $this->assertSame(IntakeResult::Appended, $report->outcome->result);
        $this->assertSame($case->id, $report->outcome->case->id);
        $this->assertSame('Re: '.$case->subject, $report->mailboxMessage->subject);
        $this->assertSame($count + 1, $case->messages()->count());
        $this->assertNull($script->deliverReply(case: $case));
        $this->assertSame(2, $script->progress()->delivered);
    }

    /**
     * @return void
     */
    public function test_unspecified_reply_chooses_oldest_eligible_open_case_and_skips_closed_and_pending_threads(): void
    {
        CaseRecord::query()->where('number', 'CASE-0016')->update(['received_at' => CarbonImmutable::now()->subYears(3)]);
        CaseRecord::query()->where('number', 'CASE-0010')->update(['status' => CaseStatus::Closed, 'received_at' => CarbonImmutable::now()->subYears(2)]);
        $expected = CaseRecord::query()->where('number', 'CASE-0012')->sole();
        $expected->fill(['received_at' => CarbonImmutable::now()->subYear()])->save();

        $report = app(InboxScript::class)->deliverReply();
        $this->assertSame($expected->id, $report->outcome->case->id);
    }

    /**
     * @return void
     */
    public function test_auto_reply_reads_latest_message_from_database_and_respects_pending_delivery(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $case->load('latestMessage');
        $script = app(InboxScript::class);
        $this->assertNull($script->autoReply(case: $case));
        CaseMessage::factory()->create(['case_id' => $case->id, 'direction' => MessageDirection::Outbound, 'sent_at' => CarbonImmutable::now()->addMinute()]);
        $this->assertNull($script->autoReply(case: $case));
        $script->deliverNext();
        $script->deliverNext();
        $this->assertNotNull($script->autoReply(case: $case));
        $this->assertNull($script->autoReply(case: $case));

        $other = CaseRecord::query()->where('number', 'CASE-0010')->sole();
        CaseMessage::factory()->create(['case_id' => $other->id, 'direction' => MessageDirection::Outbound, 'sent_at' => CarbonImmutable::now()->subMinute()]);
        CaseMessage::factory()->create(['case_id' => $other->id, 'direction' => MessageDirection::Inbound, 'sent_at' => CarbonImmutable::now()->addMinute()]);
        $this->assertNull($script->autoReply(case: $other));
    }

    /**
     * @return void
     */
    public function test_intake_failure_rolls_back_delivery_mail_attachments_case_and_cursor(): void
    {
        ScriptEntry::query()->where('kind', ScriptEntryKind::Delivery)->where('position', '<', 4)->update(['delivered_at' => CarbonImmutable::now()]);
        $mailCount = MailboxMessage::query()->count();
        $attachmentCount = MailboxAttachment::query()->count();
        $notificationCount = User::query()->sole()->notifications()->count();
        $cursor = InstallationMeta::query()->sole()->mailbox_cursor;
        $connector = Mockery::mock(MailboxConnector::class);
        $connector->shouldReceive('pull')->once()->andReturnUsing(fn (?string $cursor) => (new SimulatedMailbox)->pull($cursor));
        $connector->shouldReceive('send')->once()->andThrow(new RuntimeException('Intake unavailable.'));
        $this->app->instance(MailboxConnector::class, $connector);

        try {
            app(InboxScript::class)->deliverNext();
            $this->fail('Expected intake failure.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Intake unavailable.', $exception->getMessage());
        }

        $this->assertSame($mailCount, MailboxMessage::query()->count());
        $this->assertSame($attachmentCount, MailboxAttachment::query()->count());
        $this->assertSame($notificationCount, User::query()->sole()->notifications()->count());
        $this->assertSame(17, CaseNumberSequence::query()->sole()->next_number);
        $this->assertSame($cursor, InstallationMeta::query()->sole()->mailbox_cursor);
        $this->assertNull(ScriptEntry::query()->where('kind', ScriptEntryKind::Delivery)->where('position', 4)->sole()->delivered_at);
        $this->assertSame(16, CaseRecord::query()->count());
    }

    /**
     * @return void
     */
    public function test_overlapping_processes_serialize_delivery_and_consume_distinct_entries(): void
    {
        $database = $this->buildTemplate();
        config(['database.connections.script_concurrency' => array_replace(config('database.connections.sqlite'), ['database' => $database])]);
        $processes = [];
        $input = new InputStream;
        $source = <<<'PHP'
            require $argv[1].'/vendor/autoload.php';
            $application = require $argv[1].'/bootstrap/app.php';
            $application->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
            config(['database.connections.sqlite.database' => $argv[2]]);
            if ($argv[3] === '0') {
                $paused = false;
                Illuminate\Support\Facades\DB::listen(function (Illuminate\Database\Events\QueryExecuted $query) use (&$paused): void {
                    if (! $paused && str_contains($query->sql, 'select * from "script_entries"')) {
                        $paused = true;
                        fwrite(STDOUT, "locked\n");
                        fgets(STDIN);
                    }
                });
            } else {
                fwrite(STDOUT, "attempting\n");
            }
            $started = microtime(true);
            $report = app(App\Demo\InboxScript::class)->deliverNext();
            fwrite(STDOUT, json_encode(['id' => $report->mailboxMessage->id, 'thread' => $report->mailboxMessage->thread_id, 'elapsed' => microtime(true) - $started], JSON_THROW_ON_ERROR)."\n");
            PHP;

        try {
            foreach ([0, 1] as $worker) {
                $process = new Process([PHP_BINARY, '-r', $source, base_path(), $database, (string) $worker], base_path(), [
                    'PAO_DISABLE' => '1',
                    'APP_ENV' => 'testing',
                    'CASEFILE_MODE' => 'local',
                    'DB_CONNECTION' => 'sqlite',
                    'DB_DATABASE' => ':memory:',
                    'DB_URL' => '',
                    'CACHE_STORE' => 'array',
                    'SESSION_DRIVER' => 'array',
                    'QUEUE_CONNECTION' => 'sync',
                ], timeout: 10);

                if ($worker === 0) {
                    $process->setInput($input);
                }

                $processes[] = $process;
                $process->start();
                $ready = $worker === 0 ? "locked\n" : "attempting\n";
                $this->assertTrue($process->waitUntil(fn (): bool => str_contains($process->getOutput(), $ready)), $process->getErrorOutput());
            }

            usleep(300000);
            $this->assertTrue($processes[1]->isRunning());
            $input->write("release\n");
            $input->close();

            foreach ($processes as $process) {
                $this->assertSame(0, $process->wait(), $process->getErrorOutput());
            }

            $first = json_decode(explode("\n", trim($processes[0]->getOutput()))[1], true, flags: JSON_THROW_ON_ERROR);
            $second = json_decode(explode("\n", trim($processes[1]->getOutput()))[1], true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('thread-script-01', $first['thread']);
            $this->assertSame('thread-0016', $second['thread']);
            $this->assertNotSame($first['id'], $second['id']);
            $this->assertGreaterThanOrEqual(0.25, $second['elapsed']);
            $this->assertSame(2, DB::connection('script_concurrency')->table('script_entries')->where('kind', ScriptEntryKind::Delivery->value)->whereNotNull('delivered_at')->count());
            $this->assertSame(2, DB::connection('script_concurrency')->table('mailbox_messages')->where('gmail_message_id', 'like', 'script-%')->count());
        } finally {
            foreach ($processes as $process) {
                $process->stop(0);
            }

            $input->close();
            DB::purge('script_concurrency');
        }
    }
}
