<?php

namespace Tests\Feature;

use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\MailboxLabel;
use App\Enums\MessageDirection;
use App\Enums\ScriptEntryKind;
use App\Models\Attachment;
use App\Models\CaseEvent;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\MailboxAttachment;
use App\Models\MailboxMessage;
use App\Models\ScriptEntry;
use App\Models\TrackedSender;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;
use ValueError;

class SchemaTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    public function test_every_table_exists_on_in_memory_database(): void
    {
        $this->assertSame(':memory:', config('database.connections.sqlite.database'));

        foreach ([
            'users',
            'tracked_senders',
            'cases',
            'case_messages',
            'attachments',
            'case_events',
            'mailbox_messages',
            'mailbox_attachments',
            'script_entries',
            'case_number_sequence',
            'installation_meta',
            'notifications',
        ] as $table) {
            $this->assertTrue(Schema::hasTable($table), $table);
        }
    }

    /**
     * @return void
     */
    public function test_listed_columns_exist(): void
    {
        $expected = [
            'tracked_senders' => ['email', 'name', 'label', 'is_active'],
            'cases' => ['number', 'status', 'issue', 'notes', 'tracked_sender_id', 'sender_email', 'sender_name', 'subject', 'thread_id', 'received_at', 'closed_at'],
            'case_messages' => ['case_id', 'mailbox_message_id', 'gmail_message_id', 'thread_id', 'direction', 'from_email', 'from_name', 'to_email', 'subject', 'body_text', 'sent_at'],
            'attachments' => ['case_message_id', 'filename', 'mime_type', 'size_bytes', 'storage_path'],
            'mailbox_attachments' => ['mailbox_message_id', 'filename', 'mime_type', 'size_bytes', 'storage_path'],
            'case_events' => ['case_id', 'kind', 'from_status', 'to_status', 'occurred_at'],
            'mailbox_messages' => ['gmail_message_id', 'thread_id', 'label', 'from_email', 'from_name', 'to_email', 'subject', 'body_text', 'snippet', 'is_notification', 'received_at'],
            'script_entries' => ['kind', 'position', 'thread_id', 'payload', 'delivered_at'],
            'case_number_sequence' => ['next_number'],
            'installation_meta' => ['schema_version', 'seeded_at', 'dates_shifted_to', 'mailbox_cursor'],
            'users' => ['google_subject', 'password'],
        ];

        foreach ($expected as $table => $columns) {
            foreach ($columns as $column) {
                $this->assertTrue(Schema::hasColumn($table, $column), $table.'.'.$column);
            }
        }
    }

    /**
     * @return void
     */
    public function test_database_defaults_apply(): void
    {
        $now = '2026-10-14 09:00:00';
        DB::table('tracked_senders')->insert(['email' => 'a@mail.example', 'name' => 'A', 'created_at' => $now, 'updated_at' => $now]);
        DB::table('mailbox_messages')->insert([
            'gmail_message_id' => 'mbx-default',
            'thread_id' => 'thread-default',
            'label' => 'inbox',
            'from_email' => 'a@mail.example',
            'to_email' => 'b@mail.example',
            'subject' => 'Hello',
            'body_text' => 'Body',
            'snippet' => 'Body',
            'received_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->assertTrue(TrackedSender::query()->firstOrFail()->is_active);
        $this->assertFalse(MailboxMessage::query()->firstOrFail()->is_notification);
    }

    /**
     * @return void
     */
    public function test_declared_indexes_exist(): void
    {
        $this->assertTrue(Schema::hasIndex('cases', ['status']));
        $this->assertTrue(Schema::hasIndex('cases', ['received_at']));
        $this->assertTrue(Schema::hasIndex('case_messages', ['thread_id']));
        $this->assertTrue(Schema::hasIndex('mailbox_messages', ['thread_id']));
        $this->assertTrue(Schema::hasIndex('case_messages', ['mailbox_message_id'], 'unique'));
    }

    /**
     * @return void
     */
    public function test_a_mailbox_message_maps_to_at_most_one_case_message(): void
    {
        $mailbox = MailboxMessage::factory()->create();
        CaseMessage::factory()->create(['mailbox_message_id' => $mailbox->id]);
        CaseMessage::factory()->create(['mailbox_message_id' => null]);
        CaseMessage::factory()->create(['mailbox_message_id' => null]);

        $this->expectException(QueryException::class);

        CaseMessage::factory()->create(['mailbox_message_id' => $mailbox->id]);
    }

    /**
     * @return void
     */
    public function test_factories_derive_consistent_rows(): void
    {
        $sender = TrackedSender::factory()->create();
        $case = CaseRecord::factory()->for($sender)->create();
        $message = CaseMessage::factory()->for($case, 'case')->create();

        $this->assertSame($sender->email, $case->sender_email);
        $this->assertSame($sender->name, $case->sender_name);
        $this->assertSame($case->thread_id, $message->thread_id);
        $this->assertSame($case->sender_email, $message->from_email);
        $this->assertSame($case->sender_name, $message->from_name);
        $this->assertMatchesRegularExpression('/^CASE-(?!0000)\d{4}$/', $case->number);
        $this->assertSame(1, TrackedSender::query()->count());
    }

    /**
     * @return void
     */
    public function test_bare_case_make_saves_exactly_one_tracked_sender_and_no_case(): void
    {
        $case = CaseRecord::factory()->make();

        $this->assertSame(1, TrackedSender::query()->count());
        $this->assertSame(0, CaseRecord::query()->count());
        $this->assertSame(TrackedSender::query()->firstOrFail()->email, $case->sender_email);
    }

    /**
     * @return void
     */
    public function test_make_with_explicit_sender_saves_nothing(): void
    {
        $sender = TrackedSender::factory()->create();

        CaseRecord::factory()->make(['tracked_sender_id' => $sender->id]);

        $this->assertSame(1, TrackedSender::query()->count());
        $this->assertSame(0, CaseRecord::query()->count());
    }

    /**
     * @return void
     */
    public function test_without_parents_make_works_and_writes_nothing(): void
    {
        $case = CaseRecord::factory()->withoutParents()->make();
        $message = CaseMessage::factory()->withoutParents()->make();

        $this->assertNull($case->sender_email);
        $this->assertNull($case->sender_name);
        $this->assertNull($message->from_email);
        $this->assertNull($message->from_name);
        $this->assertNull($message->thread_id);
        $this->assertSame(0, TrackedSender::query()->count());
        $this->assertSame(0, CaseRecord::query()->count());
    }

    /**
     * @return void
     */
    public function test_timestamps_are_immutable(): void
    {
        $case = CaseRecord::factory()->create()->refresh();

        $this->assertInstanceOf(CarbonImmutable::class, $case->created_at);
        $this->assertInstanceOf(CarbonImmutable::class, $case->updated_at);
        $this->assertInstanceOf(CarbonImmutable::class, $case->trackedSender->created_at);
    }

    /**
     * @return void
     */
    public function test_duplicate_case_number_is_rejected(): void
    {
        CaseRecord::factory()->create(['number' => 'CASE-0001']);

        $this->expectException(QueryException::class);

        CaseRecord::factory()->create(['number' => 'CASE-0001']);
    }

    /**
     * @return void
     */
    public function test_duplicate_case_thread_id_is_rejected(): void
    {
        CaseRecord::factory()->create(['thread_id' => 'thread-one']);

        $this->expectException(QueryException::class);

        CaseRecord::factory()->create(['thread_id' => 'thread-one']);
    }

    /**
     * @return void
     */
    public function test_duplicate_tracked_sender_email_is_rejected(): void
    {
        TrackedSender::factory()->create(['email' => 'priya@mail.example']);

        $this->expectException(QueryException::class);

        TrackedSender::factory()->create(['email' => 'priya@mail.example']);
    }

    /**
     * @return void
     */
    public function test_duplicate_gmail_message_ids_are_rejected(): void
    {
        CaseMessage::factory()->create(['gmail_message_id' => 'msg-one']);

        $this->expectException(QueryException::class);

        CaseMessage::factory()->create(['gmail_message_id' => 'msg-one']);
    }

    /**
     * @return void
     */
    public function test_duplicate_mailbox_gmail_message_ids_are_rejected(): void
    {
        MailboxMessage::factory()->create(['gmail_message_id' => 'mbx-one']);

        $this->expectException(QueryException::class);

        MailboxMessage::factory()->create(['gmail_message_id' => 'mbx-one']);
    }

    /**
     * @return void
     */
    public function test_duplicate_script_positions_are_rejected_but_nulls_repeat(): void
    {
        ScriptEntry::factory()->create(['position' => null]);
        ScriptEntry::factory()->create(['position' => null]);
        ScriptEntry::factory()->create(['position' => 1]);

        $this->expectException(QueryException::class);

        ScriptEntry::factory()->create(['position' => 1]);
    }

    /**
     * @return void
     */
    public function test_duplicate_google_subject_is_rejected_but_nulls_repeat(): void
    {
        User::query()->create(['name' => 'One', 'email' => 'one@mail.example', 'google_subject' => null]);
        User::query()->create(['name' => 'Two', 'email' => 'two@mail.example', 'google_subject' => null]);
        User::query()->create(['name' => 'Three', 'email' => 'three@mail.example', 'google_subject' => 'sub-1']);

        $this->expectException(QueryException::class);

        User::query()->create(['name' => 'Four', 'email' => 'four@mail.example', 'google_subject' => 'sub-1']);
    }

    /**
     * @return void
     */
    public function test_user_can_exist_without_password(): void
    {
        $user = User::query()->create(['name' => 'Operator', 'email' => 'op@mail.example', 'google_subject' => 'sub-9']);

        $this->assertNull($user->refresh()->password);
        $this->assertSame('sub-9', $user->google_subject);
    }

    /**
     * @return void
     */
    public function test_casts_return_enums_and_immutable_dates(): void
    {
        $case = CaseRecord::factory()->create(['status' => 'in_progress', 'closed_at' => '2026-10-14 09:30:00'])->refresh();
        $message = CaseMessage::factory()->create(['case_id' => $case->id, 'direction' => 'outbound'])->refresh();
        $event = CaseEvent::factory()->create([
            'case_id' => $case->id,
            'kind' => 'status_changed',
            'from_status' => 'open',
            'to_status' => 'in_progress',
        ])->refresh();
        $mailbox = MailboxMessage::factory()->create(['label' => 'sent', 'is_notification' => 1])->refresh();
        $entry = ScriptEntry::factory()->create([
            'kind' => 'scripted_reply',
            'payload' => ['body_text' => 'Thanks', 'nested' => ['a' => 1]],
        ])->refresh();

        $this->assertSame(CaseStatus::InProgress, $case->status);
        $this->assertInstanceOf(CarbonImmutable::class, $case->received_at);
        $this->assertInstanceOf(CarbonImmutable::class, $case->closed_at);
        $this->assertSame(MessageDirection::Outbound, $message->direction);
        $this->assertInstanceOf(CarbonImmutable::class, $message->sent_at);
        $this->assertSame(CaseEventKind::StatusChanged, $event->kind);
        $this->assertSame(CaseStatus::Open, $event->from_status);
        $this->assertSame(CaseStatus::InProgress, $event->to_status);
        $this->assertInstanceOf(CarbonImmutable::class, $event->occurred_at);
        $this->assertSame(MailboxLabel::Sent, $mailbox->label);
        $this->assertTrue($mailbox->is_notification);
        $this->assertSame(ScriptEntryKind::ScriptedReply, $entry->kind);
        $this->assertSame(['body_text' => 'Thanks', 'nested' => ['a' => 1]], $entry->payload);
        $this->assertNull($entry->delivered_at);
    }

    /**
     * @return void
     */
    public function test_unknown_enum_value_in_storage_throws_on_read(): void
    {
        $case = CaseRecord::factory()->create();
        CaseRecord::query()->whereKey($case->id)->toBase()->update(['status' => 'archived']);

        $this->expectException(ValueError::class);

        $this->assertNotNull($case->refresh()->status);
    }

    /**
     * @return void
     */
    public function test_case_relations_resolve(): void
    {
        $case = CaseRecord::factory()->create();
        $late = CaseMessage::factory()->create(['case_id' => $case->id, 'sent_at' => '2026-10-14 12:00:00']);
        $early = CaseMessage::factory()->create(['case_id' => $case->id, 'sent_at' => '2026-10-14 08:00:00']);
        $attachment = Attachment::factory()->create(['case_message_id' => $early->id]);
        $event = CaseEvent::factory()->create(['case_id' => $case->id]);
        CaseMessage::factory()->create();

        $this->assertSame([$early->id, $late->id], $case->messages->pluck('id')->all());
        $this->assertSame($late->id, $case->latestMessage->id);
        $this->assertSame([$attachment->id], $case->attachments->pluck('id')->all());
        $this->assertSame([$event->id], $case->events->pluck('id')->all());
        $this->assertSame($case->tracked_sender_id, $case->trackedSender->id);
        $this->assertSame([$case->id], $case->trackedSender->cases->pluck('id')->all());
        $this->assertSame($case->id, $early->case->id);
        $this->assertSame([$attachment->id], $early->attachments->pluck('id')->all());
    }

    /**
     * @return void
     */
    public function test_mailbox_relations_resolve(): void
    {
        $mailbox = MailboxMessage::factory()->create();
        $mailboxAttachment = MailboxAttachment::factory()->create(['mailbox_message_id' => $mailbox->id]);
        $linked = CaseMessage::factory()->create(['mailbox_message_id' => $mailbox->id]);

        $this->assertSame([$mailboxAttachment->id], $mailbox->attachments->pluck('id')->all());
        $this->assertSame($linked->id, $mailbox->caseMessage->id);
        $this->assertSame($mailbox->id, $linked->mailboxMessage->id);
    }

    /**
     * @return void
     */
    public function test_deleting_a_case_cascades_to_children(): void
    {
        $case = CaseRecord::factory()->create();
        $message = CaseMessage::factory()->create(['case_id' => $case->id]);
        Attachment::factory()->create(['case_message_id' => $message->id]);
        CaseEvent::factory()->create(['case_id' => $case->id]);

        $case->delete();

        $this->assertSame(0, CaseMessage::query()->count());
        $this->assertSame(0, Attachment::query()->count());
        $this->assertSame(0, CaseEvent::query()->count());
    }

    /**
     * @return void
     */
    public function test_tracked_sender_with_cases_cannot_be_deleted(): void
    {
        $case = CaseRecord::factory()->create();

        $this->expectException(QueryException::class);

        $case->trackedSender->delete();
    }

    /**
     * @return void
     */
    public function test_deleting_a_mailbox_message_keeps_the_case_message(): void
    {
        $mailbox = MailboxMessage::factory()->create();
        $linked = CaseMessage::factory()->create(['mailbox_message_id' => $mailbox->id]);

        $mailbox->delete();

        $this->assertNull($linked->refresh()->mailbox_message_id);
    }

    /**
     * @return void
     */
    public function test_case_message_requires_an_existing_case(): void
    {
        $this->expectException(QueryException::class);

        CaseMessage::factory()->create([
            'case_id' => 999999,
            'thread_id' => 'thread-orphan',
            'from_email' => 'a@mail.example',
            'from_name' => 'A',
        ]);
    }
}
