<?php

namespace Tests\Feature;

use App\Demo\InboxScript;
use App\Enums\FixtureFile;
use App\Enums\MailboxLabel;
use App\Enums\ScriptEntryKind;
use App\Http\Middleware\UseSandboxDatabase;
use App\Models\MailboxAttachment;
use App\Models\MailboxMessage;
use App\Models\ScriptEntry;
use App\Models\TrackedSender;
use App\Models\User;
use App\Queries\MailboxListQuery;
use Carbon\CarbonImmutable;
use Dom\HTMLDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class InboxPageTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->withCookie(config('casefile.layout.cookie'), 'desk');
        $this->seed();
        $this->withSession([])->withCookie(config('session.cookie'), session()->getId())->withCredentials();
        $this->actingAs(User::query()->sole());
    }

    /**
     * @return void
     */
    public function test_default_inbox_lists_only_inbox_newest_first_with_a_matching_count(): void
    {
        $expected = MailboxMessage::query()->where('label', MailboxLabel::Inbox)->orderByDesc('received_at')->orderByDesc('id')->pluck('id')->all();
        $response = $this->get(route('inbox'))->assertOk()->assertViewHas('label', 'inbox');
        $this->assertSame($expected, $response->viewData('messages')->modelKeys());
        $response->assertSee(count($expected).' messages')->assertSee('0 of 8 delivered');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertSame(count($expected), $document->querySelectorAll('.mail-row')->length);
        $this->assertSame('page', $document->querySelector('.mail-labels a')->getAttribute('aria-current'));
    }

    /**
     * @return void
     */
    public function test_sent_and_all_labels_include_the_correct_rows_and_sent_case_links(): void
    {
        $sent = $this->get(route('inbox', ['label' => 'sent']))->assertOk()->assertViewHas('label', 'sent');
        $this->assertSame(MailboxMessage::query()->where('label', MailboxLabel::Sent)->count(), $sent->viewData('messages')->total());
        foreach ($sent->viewData('messages') as $message) {
            $this->assertSame(MailboxLabel::Sent, $message->label);
            $this->assertNotNull($message->caseMessage?->case);
            $sent->assertSee(route('cases.show', $message->caseMessage->case), false)->assertSee('To: '.$message->to_email);
        }
        $all = $this->get(route('inbox', ['label' => 'all']))->assertOk();
        $this->assertSame(MailboxMessage::query()->count(), $all->viewData('messages')->total());
        $all->assertSee('All mail');
    }

    /**
     * @return void
     */
    public function test_tracked_untracked_and_notification_rows_have_truthful_indicators(): void
    {
        $response = $this->get(route('inbox'))->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $notificationCount = 0;
        foreach ($response->viewData('messages') as $position => $message) {
            $row = $document->querySelectorAll('.mail-row')->item($position);
            if ($message->is_notification) {
                $this->assertStringContainsString('Casefile notification', $row->textContent);
                $this->assertNull($row->querySelector('.tracked-badge'));
                $notificationCount++;
            } elseif ($message->sender?->is_active) {
                $this->assertNotNull($row->querySelector('.tracked-badge'));
                $this->assertNotNull($row->querySelector('.mail-case-chip'));
            } else {
                $this->assertStringContainsString('Not tracked', $row->textContent);
                $this->assertNull($row->querySelector('.tracked-badge'));
            }
        }
        $this->assertSame(2, $notificationCount);
    }

    /**
     * @return void
     */
    public function test_pagination_is_bounded_and_keeps_the_label_in_links(): void
    {
        MailboxMessage::factory()->count(53)->create(['label' => MailboxLabel::Sent, 'received_at' => CarbonImmutable::now()->addDay()]);
        $first = $this->get(route('inbox', ['label' => 'sent']))->assertOk();
        $this->assertCount(50, $first->viewData('messages'));
        $first->assertSee('label=sent&amp;page=2', false);
        $second = $this->get(route('inbox', ['label' => 'sent', 'page' => 2]))->assertOk();
        $this->assertEmpty(array_intersect($first->viewData('messages')->modelKeys(), $second->viewData('messages')->modelKeys()));
        $this->assertSame(50, (new MailboxListQuery(label: null))->paginate(500)->perPage());
        $this->assertSame(1, (new MailboxListQuery(label: null))->paginate(0)->perPage());
    }

    /**
     * @return array<string, array{array<string, mixed>, string}>
     */
    public static function invalidFilters(): array
    {
        return [
            'unknown label' => [['label' => 'trash'], 'label'],
            'array label' => [['label' => ['inbox']], 'label'],
            'blank label' => [['label' => ''], 'label'],
            'negative page' => [['page' => -1], 'page'],
            'array page' => [['page' => [1]], 'page'],
            'fractional page' => [['page' => '1.5'], 'page'],
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @param  string  $field
     * @return void
     */
    #[DataProvider('invalidFilters')]
    public function test_bad_filters_redirect_to_a_clean_inbox_without_a_loop(array $input, string $field): void
    {
        $this->get(route('inbox', $input))->assertRedirect(route('inbox'))->assertSessionHasErrors($field);
        $this->get(route('inbox'))->assertOk()->assertSee('role="alert"', false);
    }

    /**
     * @return void
     */
    public function test_full_cousin_message_prefills_tracking_and_the_existing_add_action_backfills(): void
    {
        $message = MailboxMessage::query()->where('gmail_message_id', 'msg-sam-01')->sole();
        $this->get(route('inbox.show', $message))->assertOk()->assertSee($message->body_text)
            ->assertSee('Track this sender')->assertSee('value="sam.whitfield@mail.example"', false)
            ->assertSee('value="Sam Whitfield"', false)->assertSee(route('senders.store'), false);
        $this->post(route('senders.store'), ['email' => $message->from_email, 'name' => $message->from_name])->assertRedirect();
        $sender = TrackedSender::query()->where('email', $message->from_email)->sole();
        $this->assertSame(1, $sender->cases()->count());
        $this->get(route('inbox.show', $message))->assertOk()->assertSee('CASE-0017')->assertDontSee('Track this sender');
    }

    /**
     * @return void
     */
    public function test_inactive_sender_reactivates_instead_of_attempting_a_duplicate_add(): void
    {
        $message = MailboxMessage::query()->where('gmail_message_id', 'msg-jade-01')->sole();
        $sender = TrackedSender::query()->where('email', $message->from_email)->sole();
        $this->assertFalse($sender->is_active);
        $response = $this->get(route('inbox.show', $message))->assertOk()->assertSee('Reactivate sender')
            ->assertSee(route('senders.reactivate', $sender), false)->assertDontSee('Track this sender');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertNull($document->querySelector('.mailbox-message .tracked-badge'));
        $this->post(route('senders.reactivate', $sender))->assertRedirect();
        $this->assertTrue($sender->fresh()->is_active);
        $this->assertSame(5, TrackedSender::query()->count());
        $this->get(route('inbox.show', $message))->assertOk()->assertSee('CASE-0017')->assertDontSee('Reactivate sender');
    }

    /**
     * @return void
     */
    public function test_deactivated_case_sender_keeps_case_link_without_a_tracked_badge(): void
    {
        $message = MailboxMessage::query()->whereHas('caseMessage')->where('label', MailboxLabel::Inbox)->firstOrFail();
        $message->sender->update(['is_active' => false]);
        $response = $this->get(route('inbox.show', $message))->assertOk()->assertSee($message->caseMessage->case->number)->assertSee('Reactivate sender');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertNull($document->querySelector('.mailbox-message .tracked-badge'));
    }

    /**
     * @return void
     */
    public function test_notifications_and_sent_messages_do_not_offer_tracking(): void
    {
        $notification = MailboxMessage::query()->where('is_notification', true)->firstOrFail();
        $this->get(route('inbox.show', $notification))->assertOk()->assertSee('Casefile notification')->assertDontSee('Track this sender');
        $sent = MailboxMessage::query()->where('label', MailboxLabel::Sent)->firstOrFail();
        $this->get(route('inbox.show', ['message' => $sent, 'label' => 'all']))->assertOk()->assertDontSee('Track this sender')->assertSee('label=all', false);
    }

    /**
     * @return void
     */
    public function test_email_text_and_prefilled_fields_are_escaped(): void
    {
        $payload = '<script>alert("mail")</script>';
        $message = MailboxMessage::factory()->create(['from_name' => $payload, 'subject' => $payload, 'body_text' => $payload, 'snippet' => $payload]);
        $this->get(route('inbox.show', $message))->assertOk()->assertSee($payload)->assertDontSee($payload, false)->assertDontSee(' style="', false);
        $this->get(route('inbox'))->assertOk()->assertSee($payload)->assertDontSee($payload, false)->assertDontSee(' style="', false);
    }

    /**
     * @return void
     */
    public function test_delivering_next_updates_progress_and_local_finish_has_no_reset(): void
    {
        $this->from(route('inbox'))->post(route('demo.deliver-next'))->assertRedirect(route('inbox'))->assertSessionHas('status');
        $this->get(route('inbox'))->assertOk()->assertSee('1 of 8 delivered');
        for ($remaining = 0; $remaining < 7; $remaining++) {
            app(InboxScript::class)->deliverNext();
        }
        $this->get(route('inbox'))->assertOk()->assertSee('8 of 8 delivered')
            ->assertSee('Script finished. All scripted emails have been delivered.')
            ->assertDontSee('Reset the demo to replay.')->assertDontSee('Reset my demo')->assertDontSee('Deliver next email');
        $this->post(route('demo.reset'))->assertNotFound();
    }

    /**
     * @return void
     */
    public function test_finished_demo_exposes_a_pending_csrf_protected_reset_form(): void
    {
        ScriptEntry::query()->where('kind', ScriptEntryKind::Delivery)->update(['delivered_at' => CarbonImmutable::now()]);
        config(['casefile.mode' => 'demo']);
        $this->withoutMiddleware(UseSandboxDatabase::class);
        $response = $this->get(route('inbox'))->assertOk()->assertSee('Script finished. Reset the demo to replay.');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $form = $document->querySelector('.demo-controls form[action="'.route('demo.reset').'"]');
        $this->assertNotNull($form);
        $this->assertTrue($form->hasAttribute('data-pending'));
        $this->assertNotNull($form->querySelector('input[name="_token"]'));
    }

    /**
     * @return void
     */
    public function test_production_never_resolves_the_demo_script_or_renders_controls(): void
    {
        config(['casefile.mode' => 'production']);
        $this->app->bind(InboxScript::class, fn () => throw new RuntimeException('Demo script must not load.'));
        $this->get(route('inbox'))->assertOk()->assertDontSee('Simulated mailbox controls')->assertDontSee('Deliver next email')->assertDontSee('Deliver a reply');
        $this->get(route('inbox.show', MailboxMessage::query()->firstOrFail()))->assertOk()->assertDontSee('Deliver a reply');
    }

    /**
     * @return void
     */
    public function test_untracked_attachments_are_linked_and_delivered_with_the_same_safe_headers(): void
    {
        $message = MailboxMessage::query()->where('gmail_message_id', 'msg-sam-01')->sole();
        $attachment = MailboxAttachment::factory()->create(['mailbox_message_id' => $message->id, 'filename' => 'quote.pdf', 'mime_type' => 'application/pdf', 'storage_path' => FixtureFile::SnowClearingQuote->value]);
        $this->get(route('inbox.show', $message))->assertOk()->assertSee(route('mailbox-attachments.show', $attachment), false)->assertSee('quote.pdf');
        $response = $this->get(route('mailbox-attachments.show', $attachment))->assertOk();
        $this->assertSame('application/pdf', $response->headers->get('Content-Type'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $this->assertSame("default-src 'none'", $response->headers->get('Content-Security-Policy'));
        $this->assertSame('inline; filename=quote.pdf', $response->headers->get('Content-Disposition'));
        $this->assertSame(FixtureFile::SnowClearingQuote->path(), $response->baseResponse->getFile()->getPathname());
    }

    /**
     * @return void
     */
    public function test_html_attachment_downloads_and_missing_or_traversal_files_fail_closed(): void
    {
        $attachment = MailboxAttachment::factory()->create(['filename' => 'unsafe.html', 'mime_type' => 'text/html', 'storage_path' => FixtureFile::ThermostatError->value]);
        $response = $this->get(route('mailbox-attachments.show', $attachment))->assertOk();
        $this->assertSame('application/octet-stream', $response->headers->get('Content-Type'));
        $this->assertSame("sandbox; default-src 'none'", $response->headers->get('Content-Security-Policy'));
        $this->assertSame('attachment; filename=unsafe.html', $response->headers->get('Content-Disposition'));
        $attachment->update(['storage_path' => '../../../composer.json']);
        $this->get(route('mailbox-attachments.show', $attachment))->assertNotFound();
        $attachment->update(['storage_path' => 'missing.pdf']);
        $this->get(route('mailbox-attachments.show', $attachment))->assertNotFound();
        $this->get('/mailbox-attachments/999999')->assertNotFound();
        $this->get('/mailbox-attachments/quote.pdf')->assertNotFound();
    }

    /**
     * @return void
     */
    public function test_attachments_paginate_without_losing_the_label_context(): void
    {
        $message = MailboxMessage::factory()->create();
        MailboxAttachment::factory()->count(26)->create(['mailbox_message_id' => $message->id]);
        $response = $this->get(route('inbox.show', ['message' => $message, 'label' => 'all']))->assertOk()->assertSee('Attachments (26)');
        $this->assertCount(25, $response->viewData('attachments'));
        $response->assertSee('label=all&amp;page=2', false);
        $second = $this->get(route('inbox.show', ['message' => $message, 'label' => 'all', 'page' => 2]))->assertOk();
        $this->assertCount(1, $second->viewData('attachments'));
    }

    /**
     * @return void
     */
    public function test_list_eager_loads_relations_with_a_constant_query_count(): void
    {
        DB::enableQueryLog();
        (new MailboxListQuery(label: null))->paginate();
        $before = count(DB::getQueryLog());
        MailboxMessage::factory()->count(15)->create();
        DB::flushQueryLog();
        $messages = (new MailboxListQuery(label: null))->paginate();
        foreach ($messages as $message) {
            $message->sender;
            $message->caseMessage?->case?->trackedSender;
            $message->attachments_count;
        }
        $this->assertSame($before, count(DB::getQueryLog()));
        DB::disableQueryLog();
    }

    /**
     * @return void
     */
    public function test_missing_and_wrong_shaped_message_ids_fail_and_guests_cannot_read_mail_or_attachments(): void
    {
        $this->get('/inbox/999999')->assertNotFound();
        $this->get('/inbox/not-a-number')->assertNotFound();
        $message = MailboxMessage::query()->firstOrFail();
        $attachment = MailboxAttachment::query()->firstOrFail();
        auth()->logout();
        $this->get(route('inbox'))->assertRedirect(route('sign-in'));
        $this->get(route('inbox.show', $message))->assertRedirect(route('sign-in'));
        $this->get(route('mailbox-attachments.show', $attachment))->assertRedirect(route('sign-in'));
    }

    /**
     * @return void
     */
    public function test_all_inbox_action_forms_have_pending_feedback_and_csrf(): void
    {
        $message = MailboxMessage::query()->where('gmail_message_id', 'msg-sam-01')->sole();
        $response = $this->get(route('inbox.show', $message))->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        foreach ($document->querySelectorAll('form') as $form) {
            $this->assertTrue($form->hasAttribute('data-pending'));
            $this->assertNotNull($form->querySelector('input[name="_token"]'));
        }
        foreach ($document->querySelectorAll('.inbox-message-page a') as $link) {
            $this->assertTrue($link->hasAttribute('data-pending'));
        }
    }
}
