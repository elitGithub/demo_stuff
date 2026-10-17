<?php

namespace Tests\Feature;

use App\Actions\Cases\ChangeCaseStatus;
use App\Actions\Cases\SendCaseReply;
use App\Actions\Cases\UpdateCaseDetails;
use App\Contracts\MailboxConnector;
use App\Data\OutgoingReply;
use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\MailboxLabel;
use App\Enums\MessageDirection;
use App\Mailbox\SimulatedMailbox;
use App\Models\CaseEvent;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\MailboxMessage;
use App\Models\User;
use Carbon\CarbonImmutable;
use Dom\HTMLDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class CaseActionsTest extends TestCase
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
        CaseRecord::query()->where('number', 'CASE-0001')->update(['status' => CaseStatus::Open, 'closed_at' => null]);
    }

    /**
     * @return void
     */
    public function test_details_and_status_save_together_and_round_trip_escaped(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $this->actingAs(User::query()->sole())->patch(route('cases.update', $case), [
            'issue' => 'Door <script>alert(1)</script>', 'notes' => "First line\nSecond line", 'status' => CaseStatus::InProgress->value,
        ])->assertRedirect(route('cases.show', $case).'#case-details')->assertSessionHas('toast', 'Case details saved.');
        $case->refresh();
        $this->assertSame('Door <script>alert(1)</script>', $case->issue);
        $this->assertSame("First line\nSecond line", $case->notes);
        $this->assertSame(CaseStatus::InProgress, $case->status);
        $this->get(route('cases.show', $case))->assertOk()->assertSee('Door &lt;script&gt;alert(1)&lt;/script&gt;', false)
            ->assertSee('value="in_progress" selected', false)->assertSee('First line')->assertDontSee('<script>alert(1)</script>', false);
        $event = $case->events()->where('kind', CaseEventKind::StatusChanged)->reorder()->latest('id')->firstOrFail();
        $this->assertSame(CaseStatus::Open, $event->from_status);
        $this->assertSame(CaseStatus::InProgress, $event->to_status);
    }

    /**
     * @return void
     */
    public function test_nullable_details_clear_and_three_argument_action_remains_compatible(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $result = app(UpdateCaseDetails::class)(case: $case, issue: null, notes: null);
        $this->assertNull($result->issue);
        $this->assertNull($result->notes);
        $this->assertSame($case->status, $result->status);
        $this->actingAs(User::query()->sole())->patch(route('cases.update', $case), ['issue' => '', 'notes' => '', 'status' => 'open'])->assertRedirect();
        $this->assertNull($case->fresh()->issue);
        $this->assertNull($case->fresh()->notes);
    }

    /**
     * @return void
     */
    public function test_detail_length_and_shape_rejections_preserve_input_and_do_not_partially_save(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $before = $case->only(['issue', 'notes', 'status']);
        $longText = str_repeat('x', 5001);
        $this->actingAs(User::query()->sole())->from(route('cases.show', $case))
            ->patch(route('cases.update', $case), ['issue' => $longText, 'notes' => $longText, 'status' => 'closed'])
            ->assertSessionHasErrors(['issue', 'notes'])->assertSessionHasInput('issue', $longText)->assertSessionHasInput('notes', $longText);
        $this->get(route('cases.show', $case))->assertOk()->assertSee($longText)->assertSee('issue-error')->assertSee('notes-error');
        $this->assertEquals($before, $case->fresh()->only(['issue', 'notes', 'status']));

        foreach ([['issue' => ['bad'], 'notes' => 42, 'status' => ['open']], ['status' => 'invented'], []] as $input) {
            $this->patchJson(route('cases.update', $case), $input)->assertUnprocessable()->assertJsonValidationErrors('status');
        }

        $this->patch(route('cases.update', $case), ['issue' => ['bad'], 'notes' => ['bad'], 'status' => ['open']])->assertSessionHasErrors(['issue', 'notes', 'status']);
        $this->get(route('cases.show', $case))->assertOk()->assertSee('issue-error')->assertSee('notes-error')->assertSee('status-error');
        $this->assertEquals($before, $case->fresh()->only(['issue', 'notes', 'status']));
    }

    /**
     * @return void
     */
    public function test_maximum_details_and_reply_lengths_are_accepted(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $maximum = str_repeat('x', 5000);
        $this->actingAs(User::query()->sole())->patch(route('cases.update', $case), ['issue' => $maximum, 'notes' => $maximum, 'status' => 'open'])->assertSessionHasNoErrors();
        $this->assertSame($maximum, $case->fresh()->notes);
        $this->post(route('cases.replies.store', $case), ['body' => $maximum])->assertSessionHasNoErrors()->assertRedirect();
        $this->assertSame($maximum, $case->latestMessage()->sole()->body_text);
    }

    /**
     * @return void
     */
    public function test_close_reopen_and_repeat_status_commands_have_correct_events_and_timestamps(): void
    {
        CarbonImmutable::setTestNow('2026-10-17 10:00:00');
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $statusEventsBefore = $case->events()->where('kind', CaseEventKind::StatusChanged)->count();
        $this->actingAs(User::query()->sole())->patch(route('cases.status', $case), ['status' => 'closed'])->assertRedirect();
        $this->assertSame(CaseStatus::Closed, $case->fresh()->status);
        $closedAt = $case->fresh()->closed_at;
        $this->assertTrue($closedAt->equalTo(CarbonImmutable::now()));
        CarbonImmutable::setTestNow('2026-10-17 11:00:00');
        $this->patch(route('cases.status', $case), ['status' => 'closed'])->assertRedirect();
        $this->assertTrue($case->fresh()->closed_at->equalTo($closedAt));
        $this->assertSame($statusEventsBefore + 1, $case->events()->where('kind', CaseEventKind::StatusChanged)->count());
        $this->patch(route('cases.status', $case), ['status' => 'in_progress'])->assertRedirect();
        $this->assertNull($case->fresh()->closed_at);
        $this->assertSame(CaseStatus::InProgress, $case->fresh()->status);
        $reopened = $case->events()->where('kind', CaseEventKind::Reopened)->sole();
        $this->assertSame(CaseStatus::Closed, $reopened->from_status);
        $this->assertSame(CaseStatus::InProgress, $reopened->to_status);
        $this->assertSame($statusEventsBefore + 2, $case->events()->where('kind', CaseEventKind::StatusChanged)->count());
        CarbonImmutable::setTestNow();
    }

    /**
     * @return void
     */
    public function test_status_action_uses_stored_state_instead_of_stale_caller(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        CaseRecord::query()->whereKey($case)->update(['status' => CaseStatus::Closed, 'closed_at' => CarbonImmutable::now()]);
        app(ChangeCaseStatus::class)(case: $case, to: CaseStatus::Open);
        $this->assertSame(1, $case->events()->where('kind', CaseEventKind::Reopened)->count());
        $this->assertNull($case->fresh()->closed_at);
    }

    /**
     * @return void
     */
    public function test_failed_status_event_rolls_back_details_status_and_timestamp_together(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $before = $case->getAttributes();
        $eventCount = $case->events()->count();
        CaseEvent::creating(function (CaseEvent $event): void {
            if ($event->kind === CaseEventKind::StatusChanged) {
                throw new RuntimeException('Event write failed.');
            }
        });

        try {
            app(UpdateCaseDetails::class)(case: $case, issue: 'Changed', notes: 'Changed', status: CaseStatus::Closed);
            $this->fail('Expected an event failure.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Event write failed.', $exception->getMessage());
        }

        $this->assertEquals($before, $case->fresh()->getAttributes());
        $this->assertSame($eventCount, $case->events()->count());
    }

    /**
     * @return void
     */
    public function test_reply_stores_outbound_sent_link_and_event_and_only_one_view_gets_timer(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $this->actingAs(User::query()->sole())->get(route('cases.show', $case))->assertDontSee('data-auto-reply', false);
        $this->post(route('cases.replies.store', $case), ['body' => 'I will visit tomorrow.', 'from_email' => 'intruder@casefile.example'])
            ->assertRedirect(route('cases.show', $case).'#thread-end')->assertSessionHas('auto_reply_case', $case->number)->assertSessionHas('toast', 'Reply sent via Gmail.');
        $message = $case->latestMessage()->sole();
        $this->assertSame(MessageDirection::Outbound, $message->direction);
        $this->assertSame('I will visit tomorrow.', $message->body_text);
        $this->assertSame('dana@casefile.example', $message->from_email);
        $this->assertSame($case->sender_email, $message->to_email);
        $this->assertSame('Re: '.$case->subject, $message->subject);
        $this->assertSame($case->thread_id, $message->thread_id);
        $sent = $message->mailboxMessage;
        $this->assertNotNull($sent);
        $this->assertSame(MailboxLabel::Sent, $sent->label);
        $this->assertSame($message->gmail_message_id, $sent->gmail_message_id);
        $this->assertSame($message->thread_id, $sent->thread_id);
        $this->assertSame($message->body_text, $sent->body_text);
        $this->assertSame(2, $case->events()->where('kind', CaseEventKind::ReplySent)->count());
        $this->get(route('cases.show', $case))->assertOk()->assertSee('data-auto-reply', false)->assertSee('data-case="CASE-0001"', false)->assertSee('data-delay="20"', false)->assertSee(route('demo.auto-reply', $case))->assertSee('Waiting for a reply')->assertDontSee('flash-status', false);
        $this->get(route('cases.show', $case))->assertDontSee('data-auto-reply', false);
    }

    /**
     * @return void
     */
    public function test_outgoing_reply_uses_latest_persisted_message_for_in_reply_to(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole()->load('latestMessage');
        $latest = CaseMessage::factory()->create(['case_id' => $case->id, 'sent_at' => CarbonImmutable::now()]);
        $simulator = app(SimulatedMailbox::class);
        $connector = Mockery::mock(MailboxConnector::class);
        $connector->shouldReceive('send')->once()->with(Mockery::on(fn (OutgoingReply $reply): bool => $reply->inReplyToGmailMessageId === $latest->gmail_message_id && $reply->threadId === $case->thread_id && $reply->subject === 'Re: '.$case->subject))
            ->andReturnUsing(fn (OutgoingReply $reply) => $simulator->send($reply));
        $this->app->instance(MailboxConnector::class, $connector);
        app(SendCaseReply::class)(case: $case, bodyText: 'Acknowledged.');
    }

    /**
     * @return void
     */
    public function test_reply_on_closed_case_reopens_and_records_real_transition(): void
    {
        $case = CaseRecord::query()->where('status', CaseStatus::Closed)->firstOrFail();
        $reopenedBefore = $case->events()->where('kind', CaseEventKind::Reopened)->count();
        $this->actingAs(User::query()->sole())->post(route('cases.replies.store', $case), ['body' => 'Following up.'])->assertRedirect();
        $this->assertSame(CaseStatus::Open, $case->fresh()->status);
        $this->assertNull($case->fresh()->closed_at);
        $this->assertSame($reopenedBefore + 1, $case->events()->where('kind', CaseEventKind::Reopened)->count());
        $transition = $case->events()->where('kind', CaseEventKind::StatusChanged)->reorder()->latest('id')->firstOrFail();
        $this->assertSame(CaseStatus::Closed, $transition->from_status);
        $this->assertSame(CaseStatus::Open, $transition->to_status);
    }

    /**
     * @return void
     */
    public function test_auto_reply_success_flashes_summary_for_reload_and_false_has_no_stale_toast(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0010')->sole();
        $this->actingAs(User::query()->sole())->post(route('cases.replies.store', $case), ['body' => 'Please confirm.'])->assertRedirect();
        $this->get(route('cases.show', $case))->assertSee('data-auto-reply', false);
        $this->postJson(route('demo.auto-reply', $case))->assertOk()->assertJson(['delivered' => true])->assertSessionHas('toast', 'Added to CASE-0010');
        $this->get(route('cases.show', $case))->assertOk()->assertSee('data-toast-message>Added to CASE-0010', false)->assertDontSee('data-auto-reply', false);
        $this->postJson(route('demo.auto-reply', $case))->assertOk()->assertJson(['delivered' => false])->assertSessionMissing('toast');
    }

    /**
     * @return void
     */
    public function test_timer_never_follows_reply_to_another_case_or_a_subsequent_close(): void
    {
        $this->actingAs(User::query()->sole())->post('/cases/CASE-0001/replies', ['body' => 'Checking.'])->assertRedirect();
        $this->get('/cases/CASE-0002')->assertOk()->assertDontSee('data-auto-reply', false);
        $this->get('/cases/CASE-0001')->assertDontSee('data-auto-reply', false);
        $this->post('/cases/CASE-0001/replies', ['body' => 'Checking again.'])->assertRedirect();
        $this->patch('/cases/CASE-0001/status', ['status' => 'closed'])->assertRedirect();
        $this->get('/cases/CASE-0001')->assertDontSee('data-auto-reply', false)->assertSee('Reopen case');
    }

    /**
     * @return void
     */
    public function test_reply_failure_after_mailbox_message_and_events_rolls_every_write_back(): void
    {
        $case = CaseRecord::query()->where('status', CaseStatus::Closed)->firstOrFail();
        $before = $case->getAttributes();
        $counts = [MailboxMessage::query()->count(), CaseMessage::query()->count(), CaseEvent::query()->count()];
        CaseEvent::creating(function (CaseEvent $event): void {
            if ($event->kind === CaseEventKind::Reopened) {
                throw new RuntimeException('Reopen event failed.');
            }
        });

        try {
            app(SendCaseReply::class)(case: $case, bodyText: 'Must roll back.');
            $this->fail('Expected a reopen failure.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Reopen event failed.', $exception->getMessage());
        }

        $this->assertEquals($before, $case->fresh()->getAttributes());
        $this->assertSame($counts, [MailboxMessage::query()->count(), CaseMessage::query()->count(), CaseEvent::query()->count()]);
    }

    /**
     * @return void
     */
    public function test_invalid_reply_bodies_and_statuses_never_mutate(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $messageCount = CaseMessage::query()->count();
        $mailboxCount = MailboxMessage::query()->count();
        $this->actingAs(User::query()->sole());

        foreach (['', '   ', str_repeat('x', 5001), ['text'], 42, null] as $body) {
            $this->from(route('cases.show', $case))->post(route('cases.replies.store', $case), ['body' => $body])->assertSessionHasErrors('body');
            $this->get(route('cases.show', $case))->assertOk()->assertSee('body-error')->assertDontSee('data-auto-reply', false);
        }

        foreach (['invalid', ['open'], 42, null] as $status) {
            $this->patchJson(route('cases.status', $case), ['status' => $status])->assertUnprocessable()->assertJsonValidationErrors('status');
        }

        $this->assertSame($messageCount, CaseMessage::query()->count());
        $this->assertSame($mailboxCount, MailboxMessage::query()->count());
        $this->assertSame(CaseStatus::Open, $case->fresh()->status);
    }

    /**
     * @return void
     */
    public function test_composer_required_marker_focus_targets_and_pending_forms_are_present(): void
    {
        $this->actingAs(User::query()->sole())->get('/cases/CASE-0001')->assertOk()
            ->assertSee('id="reply-body"', false)->assertSee('id="case-notes"', false)->assertSee('required-mark', false)
            ->assertSee('Send via Gmail')->assertSee('data-pending', false)->assertSeeInOrder(['Cancel', '>Save<'], false);
    }

    /**
     * @return void
     */
    public function test_rejected_details_reveal_the_sheet_and_keep_saved_originals_separate_from_old_input(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->sole();
        $case->update(['issue' => 'Saved <issue>', 'notes' => 'Saved notes']);
        $oldIssue = str_repeat('x', 5001);
        $this->actingAs(User::query()->sole())->from(route('cases.show', $case))->patch(route('cases.update', $case), [
            'issue' => $oldIssue, 'notes' => 'Unsaved notes', 'status' => 'in_progress',
        ])->assertSessionHasErrors('issue');
        $response = $this->get(route('cases.show', $case))->assertOk()->assertSee('data-original-value="Saved &lt;issue&gt;"', false);
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $sheet = $document->querySelector('[data-details-sheet]');
        $this->assertSame('true', $sheet->getAttribute('data-has-errors'));
        $this->assertTrue($sheet->hasAttribute('open'));
        $this->assertSame($oldIssue, $document->getElementById('case-issue')->textContent);
        $this->assertSame('Saved <issue>', $document->getElementById('case-issue')->getAttribute('data-original-value'));
        $this->assertSame('Saved notes', $document->getElementById('case-notes')->getAttribute('data-original-value'));
        $this->assertSame('Unsaved notes', $document->getElementById('case-notes')->textContent);
        $this->assertSame('open', $document->getElementById('case-status')->getAttribute('data-original-value'));
        $this->assertSame('in_progress', $document->querySelector('#case-status option[selected]')->getAttribute('value'));
        $this->assertNotNull($sheet->querySelector('#issue-error'));
        $this->assertSame('true', $document->getElementById('case-issue')->getAttribute('aria-invalid'));
        $this->assertSame('Saved <issue>', $case->fresh()->issue);
    }

    /**
     * @return void
     */
    public function test_reply_errors_remain_at_composer_and_do_not_open_unrelated_details(): void
    {
        $this->actingAs(User::query()->sole())->from('/cases/CASE-0001')->post('/cases/CASE-0001/replies', ['body' => ['invalid']])->assertSessionHasErrors('body');
        $response = $this->get('/cases/CASE-0001')->assertOk()->assertSee('body-error');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertSame('false', $document->querySelector('[data-details-sheet]')->getAttribute('data-has-errors'));
        $this->assertSame('true', $document->getElementById('reply-body')->getAttribute('aria-invalid'));
        $this->assertSame('', $document->getElementById('reply-body')->getAttribute('data-original-value'));
        $this->assertTrue($document->getElementById('reply-composer')->hasAttribute('data-draft-form'));
    }

    /**
     * @return void
     */
    public function test_received_reply_discard_navigation_is_explicit_and_uses_existing_pending_handling(): void
    {
        $this->actingAs(User::query()->sole())->post('/cases/CASE-0010/replies', ['body' => 'Please confirm.'])->assertRedirect();
        $response = $this->get('/cases/CASE-0010')->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $link = $document->querySelector('[data-auto-reply-show]');
        $this->assertSame('Discard unsaved edits and show reply', $link->textContent);
        $this->assertSame(route('cases.show', ['case' => 'CASE-0010']).'#thread-end', $link->getAttribute('href'));
        $this->assertTrue($link->hasAttribute('hidden'));
        $this->assertTrue($link->hasAttribute('data-pending'));
    }

    /**
     * @return array<string, array{string, string}>
     */
    public static function mutations(): array
    {
        return ['details' => ['PATCH', '/cases/CASE-0001'], 'status' => ['PATCH', '/cases/CASE-0001/status'], 'reply' => ['POST', '/cases/CASE-0001/replies']];
    }

    /**
     * @param  string  $method
     * @param  string  $path
     * @return void
     */
    #[DataProvider('mutations')]
    public function test_mutations_require_authentication_and_enforce_real_csrf(string $method, string $path): void
    {
        $this->call($method, $path)->assertRedirect('/sign-in');
        $this->actingAs(User::query()->sole());
        $this->app['env'] = 'csrf-check';
        $this->withSession(['_token' => 'expected-token'])->call($method, $path)->assertStatus(419);
    }

    /**
     * @return void
     */
    public function test_unknown_cases_return_404_and_mutations_share_configurable_throttle(): void
    {
        config(['casefile.actions.attempts_per_minute' => 3]);
        $this->actingAs(User::query()->sole())->patch('/cases/CASE-9999/status', ['status' => 'open'])->assertNotFound();
        $this->post('/cases/CASE-9999/replies', ['body' => 'Hello'])->assertNotFound();
        $this->patch('/cases/CASE-9999', ['status' => 'open'])->assertNotFound();
        $this->travel(1)->minute();
        $this->patch('/cases/CASE-0001/status', ['status' => 'open'])->assertRedirect();
        $this->patch('/cases/CASE-0001', ['status' => 'open'])->assertRedirect();
        $this->post('/notifications/read')->assertRedirect();
        $before = CaseMessage::query()->count();
        $this->post('/cases/CASE-0001/replies', ['body' => 'Over the limit.'])->assertTooManyRequests()->assertHeader('Retry-After');
        $this->assertSame($before, CaseMessage::query()->count());
    }
}
