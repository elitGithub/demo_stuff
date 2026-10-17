<?php

namespace Tests\Feature;

use App\Contracts\MailboxConnector;
use App\Data\OutgoingReply;
use App\Enums\MailboxLabel;
use App\Mailbox\SimulatedMailbox;
use App\Models\MailboxMessage;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use InvalidArgumentException;
use Tests\TestCase;

class SimulatedMailboxTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    public function test_local_mode_binds_the_simulated_connector_and_tenant_send_only_writes_sent(): void
    {
        $connector = app(MailboxConnector::class);
        $this->assertInstanceOf(SimulatedMailbox::class, $connector);
        $sent = $connector->send(new OutgoingReply(
            threadId: 'outgoing-thread',
            to: new SenderAddress(email: 'tenant@mail.example', name: 'Tenant'),
            subject: 'Re: Window latch',
            bodyText: 'The contractor will contact you.',
            inReplyToGmailMessageId: 'original-message',
        ));
        $row = MailboxMessage::query()->sole();

        $this->assertSame(MailboxLabel::Sent, $row->label);
        $this->assertSame($sent->gmailMessageId, $row->gmail_message_id);
        $this->assertSame('outgoing-thread', $sent->threadId);
        $this->assertTrue($sent->sentAt->equalTo($row->received_at));
        $this->assertSame(config('casefile.owner.email'), $row->from_email);
        $this->assertSame('tenant@mail.example', $row->to_email);
        $this->assertFalse($row->is_notification);
    }

    /**
     * @return void
     */
    public function test_owner_send_writes_distinct_sent_and_inbox_rows_marked_as_notifications(): void
    {
        app(MailboxConnector::class)->send(new OutgoingReply(
            threadId: 'notification-thread',
            to: SenderAddress::fromHeader('  Dana <DANA@CASEFILE.EXAMPLE> '),
            subject: 'New case CASE-0017: Window latch',
            bodyText: 'Open Casefile to read the message.',
            inReplyToGmailMessageId: 'original-message',
        ));
        $rows = MailboxMessage::query()->orderBy('id')->get();

        $this->assertCount(2, $rows);
        $this->assertSame([MailboxLabel::Sent, MailboxLabel::Inbox], $rows->pluck('label')->all());
        $this->assertNotSame($rows[0]->gmail_message_id, $rows[1]->gmail_message_id);
        $this->assertTrue($rows->every(fn (MailboxMessage $row): bool => $row->is_notification));
        $this->assertSame([config('casefile.notifications.email')], $rows->pluck('from_email')->unique()->all());
        $pull = app(MailboxConnector::class)->pull(null);
        $this->assertCount(1, $pull->messages);
        $this->assertTrue($pull->messages[0]->isNotification);
    }

    /**
     * @return void
     */
    public function test_pull_returns_received_order_with_highest_id_cursor_and_copies_attachment_metadata(): void
    {
        $late = MailboxMessage::factory()->create(['from_email' => '  Priya Nair <PRIYA@MAIL.EXAMPLE>  ', 'received_at' => CarbonImmutable::now()]);
        $early = MailboxMessage::factory()->create(['received_at' => CarbonImmutable::now()->subDays(2)]);
        $early->attachments()->create(['filename' => 'invoice.pdf', 'mime_type' => 'application/pdf', 'size_bytes' => 42, 'storage_path' => 'invoice.pdf']);
        MailboxMessage::factory()->create(['label' => MailboxLabel::Sent]);
        $pull = app(MailboxConnector::class)->pull(null);

        $this->assertSame([$early->id, $late->id], array_column($pull->messages, 'mailboxMessageId'));
        $this->assertSame((string) $early->id, $pull->cursor);
        $this->assertSame('priya@mail.example', $pull->messages[1]->from->email);
        $this->assertSame('Priya Nair', $pull->messages[1]->from->name);
        $attachment = $pull->messages[0]->attachments[0];
        $this->assertSame('invoice.pdf', $attachment->filename);
        $this->assertSame('application/pdf', $attachment->mimeType);
        $this->assertSame(42, $attachment->sizeBytes);
        $this->assertSame('invoice.pdf', $attachment->storagePath);
        $empty = app(MailboxConnector::class)->pull($pull->cursor);
        $this->assertSame([], $empty->messages);
        $this->assertSame($pull->cursor, $empty->cursor);
    }

    /**
     * @return void
     */
    public function test_malformed_headers_are_reported_and_included_in_cursor_progress(): void
    {
        $bad = MailboxMessage::factory()->create(['from_email' => 'invalid <']);
        $pull = app(MailboxConnector::class)->pull(null);

        $this->assertSame([], $pull->messages);
        $this->assertSame((string) $bad->id, $pull->cursor);
        $this->assertCount(1, $pull->rejected);
        $this->assertSame($bad->gmail_message_id, $pull->rejected[0]->gmailMessageId);
        $this->assertSame('Sender header has no valid address.', $pull->rejected[0]->reason);
        $this->assertSame([], app(MailboxConnector::class)->pull($pull->cursor)->rejected);
    }

    /**
     * @return void
     */
    public function test_invalid_cursor_is_rejected_instead_of_replaying_mail(): void
    {
        $this->expectException(InvalidArgumentException::class);
        app(MailboxConnector::class)->pull('not-an-id');
    }
}
