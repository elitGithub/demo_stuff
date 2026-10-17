<?php

namespace Tests\Feature;

use App\Actions\Senders\AddTrackedSender;
use App\Actions\Senders\DeleteTrackedSender;
use App\Actions\Senders\ReactivateTrackedSender;
use App\Contracts\MailboxConnector;
use App\Data\IncomingMessage;
use App\Data\OutgoingReply;
use App\Data\SentReply;
use App\Enums\IntakeResult;
use App\Exceptions\SenderHasCases;
use App\Intake\CaseIntake;
use App\Mailbox\SimulatedMailbox;
use App\Models\CaseEvent;
use App\Models\CaseMessage;
use App\Models\CaseNumberSequence;
use App\Models\CaseRecord;
use App\Models\MailboxMessage;
use App\Models\TrackedSender;
use App\Models\User;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Dom\HTMLDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class TrackedSenderSettingsTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->seed();
        $this->withSession([])->withCookie(config('session.cookie'), session()->getId())->withCredentials();
        $this->actingAs(User::query()->sole());
    }

    /**
     * @return void
     */
    public function test_adding_display_name_header_normalizes_before_validation_and_backfills_seeded_cousin(): void
    {
        $this->post(route('senders.store'), ['email' => '  Sam Whitfield <SAM.WHITFIELD@Mail.Example> ', 'name' => 'Sam Whitfield', 'label' => 'Cousin'])
            ->assertRedirect(route('settings').'#tracked-senders')->assertSessionHasNoErrors();
        $sender = TrackedSender::query()->where('email', 'sam.whitfield@mail.example')->sole();
        $this->assertTrue($sender->is_active);
        $this->assertSame('Cousin', $sender->label);
        $this->assertSame(1, $sender->cases()->count());
        $case = $sender->cases()->sole();
        $this->assertSame('CASE-0017', $case->number);
        $this->assertSame('sam.whitfield@mail.example', $case->sender_email);
        $this->assertSame(1, $case->messages()->count());
        $this->assertSame(17, CaseRecord::query()->count());
    }

    /**
     * @return array<string, array{string}>
     */
    public static function duplicates(): array
    {
        return [
            'same' => ['priya.nair@mail.example'],
            'uppercase' => ['PRIYA.NAIR@mail.example'],
            'header' => ['  Priya Nair <PRIYA.NAIR@MAIL.EXAMPLE> '],
            'inactive' => ['JADE.OKAFOR@MAIL.EXAMPLE'],
        ];
    }

    /**
     * @param  string  $email
     * @return void
     */
    #[DataProvider('duplicates')]
    public function test_normalized_duplicates_have_email_errors_without_creating_cases(string $email): void
    {
        $this->post(route('senders.store'), ['email' => $email, 'name' => 'Replacement name'])
            ->assertRedirect(route('settings').'#add-sender')->assertSessionHasErrors(['email'], errorBag: 'addSender');
        $this->assertSame(5, TrackedSender::query()->count());
        $this->assertSame(16, CaseRecord::query()->count());
        $this->get(route('settings'))->assertOk()->assertSee('sender-email-error')->assertSee('Replacement name');
    }

    /**
     * @return void
     */
    public function test_direct_add_action_also_normalizes_and_reports_invalid_and_duplicate_email(): void
    {
        $sender = app(AddTrackedSender::class)(emailHeader: 'Some Person <NEW@MAIL.EXAMPLE>', name: 'Some Person', label: null);
        $this->assertSame('new@mail.example', $sender->email);

        foreach (['not email', '  Existing <NEW@MAIL.EXAMPLE>'] as $header) {
            try {
                app(AddTrackedSender::class)(emailHeader: $header, name: 'Another', label: null);
                $this->fail('Invalid or duplicate sender was accepted.');
            } catch (ValidationException $exception) {
                $this->assertArrayHasKey('email', $exception->errors());
            }
        }
    }

    /**
     * @return array<string, array{array<string, mixed>, list<string>}>
     */
    public static function invalidAddInputs(): array
    {
        return [
            'missing' => [[], ['email', 'name']],
            'bad email' => [['email' => 'invalid', 'name' => 'Sender'], ['email']],
            'many addresses' => [['email' => 'a@mail.example,b@mail.example', 'name' => 'Sender'], ['email']],
            'wrong shapes' => [['email' => ['a@mail.example'], 'name' => ['Sender'], 'label' => ['Tenant']], ['email', 'name', 'label']],
            'long name and label' => [['email' => 'valid@mail.example', 'name' => str_repeat('N', 121), 'label' => str_repeat('L', 61)], ['name', 'label']],
            'numeric fields' => [['email' => 1, 'name' => 2, 'label' => 3], ['email', 'name', 'label']],
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @param  list<string>  $fields
     * @return void
     */
    #[DataProvider('invalidAddInputs')]
    public function test_add_shape_validation_and_error_page_do_not_crash(array $input, array $fields): void
    {
        $this->post(route('senders.store'), $input)->assertSessionHasErrors($fields, errorBag: 'addSender');
        $document = HTMLDocument::createFromString($this->get(route('settings'))->assertOk()->getContent(), LIBXML_NOERROR);
        $this->assertSame(count($fields), $document->querySelectorAll('#add-sender .field-error')->length);
        $this->assertSame(0, $document->querySelectorAll('.sender-rename .field-error')->length);
        $this->assertSame(5, TrackedSender::query()->count());
    }

    /**
     * @return void
     */
    public function test_maximum_valid_lengths_and_optional_label_round_trip(): void
    {
        $this->post(route('senders.store'), ['email' => 'bounds@mail.example', 'name' => str_repeat('N', 120), 'label' => str_repeat('L', 60)])
            ->assertRedirect()->assertSessionHasNoErrors();
        $sender = TrackedSender::query()->where('email', 'bounds@mail.example')->sole();
        $this->assertSame(str_repeat('N', 120), $sender->name);
        $this->assertSame(str_repeat('L', 60), $sender->label);
        $this->patch(route('senders.update', $sender), ['name' => 'Changed', 'label' => ''])->assertRedirect()->assertSessionHasNoErrors();
        $this->assertNull($sender->fresh()->label);
    }

    /**
     * @return void
     */
    public function test_email_limit_applies_to_normalized_address_and_zero_label_is_visible(): void
    {
        $email = str_repeat('a', 64).'@'.str_repeat('b', 62).'.'.str_repeat('c', 62).'.'.str_repeat('d', 55).'.example';
        $this->assertSame(254, strlen($email));
        $this->post(route('senders.store'), ['email' => 'Long Display Name <'.$email.'>', 'name' => 'Long Address', 'label' => '0'])
            ->assertRedirect()->assertSessionHasNoErrors();
        $sender = TrackedSender::query()->where('email', $email)->sole();
        $this->assertSame('0', $sender->label);
        $document = HTMLDocument::createFromString($this->get(route('settings'))->assertOk()->getContent(), LIBXML_NOERROR);
        $this->assertSame('0', $document->querySelector('#sender-'.$sender->id.' th')->lastElementChild->textContent);
        $this->post(route('senders.store'), ['email' => str_replace('.example', 'x.example', $email), 'name' => 'Too Long'])
            ->assertSessionHasErrors(['email'], errorBag: 'addSender');
    }

    /**
     * @return void
     */
    public function test_rename_changes_name_and_label_only_and_escapes_html(): void
    {
        $sender = TrackedSender::query()->where('email', 'priya.nair@mail.example')->sole();
        $this->patch(route('senders.update', $sender), ['name' => '<script>bad</script>', 'label' => 'New label', 'email' => 'intruder@mail.example', 'is_active' => false])
            ->assertRedirect()->assertSessionHasNoErrors();
        $sender->refresh();
        $this->assertSame('<script>bad</script>', $sender->name);
        $this->assertSame('New label', $sender->label);
        $this->assertSame('priya.nair@mail.example', $sender->email);
        $this->assertTrue($sender->is_active);
        $this->get(route('settings'))->assertOk()->assertSee('&lt;script&gt;bad&lt;/script&gt;', false)->assertDontSee('<script>bad</script>', false);
    }

    /**
     * @return void
     */
    public function test_rename_errors_and_old_values_belong_to_only_the_submitting_form(): void
    {
        $sender = TrackedSender::query()->where('email', 'priya.nair@mail.example')->sole();
        $this->patch(route('senders.update', $sender), ['name' => 'Kept draft', 'label' => str_repeat('L', 61)])
            ->assertSessionHasErrors(['label'], errorBag: 'renameSender'.$sender->id)->assertSessionHasInput('name', 'Kept draft');
        $document = HTMLDocument::createFromString($this->get(route('settings'))->assertOk()->getContent(), LIBXML_NOERROR);
        $this->assertSame('Kept draft', $document->querySelector('#sender-'.$sender->id.'-name')->getAttribute('value'));
        $this->assertSame('', $document->querySelector('#sender-name')->getAttribute('value'));
        $this->assertSame(1, $document->querySelectorAll('.sender-rename .field-error')->length);
        $this->assertSame(0, $document->querySelectorAll('#add-sender .field-error')->length);
        $this->assertTrue($document->querySelector('#sender-'.$sender->id.' details')->hasAttribute('open'));
        $this->assertSame('Priya Nair', $sender->fresh()->name);
    }

    /**
     * @return void
     */
    public function test_wrong_shaped_rename_input_renders_safely_and_keeps_other_sender_values(): void
    {
        $sender = TrackedSender::query()->where('email', 'priya.nair@mail.example')->sole();
        $other = TrackedSender::query()->where('email', 'marcus.leblanc@mail.example')->sole();
        $this->patch(route('senders.update', $sender), ['name' => ['bad'], 'label' => ['bad']])
            ->assertSessionHasErrors(['name', 'label'], errorBag: 'renameSender'.$sender->id);
        $document = HTMLDocument::createFromString($this->get(route('settings'))->assertOk()->getContent(), LIBXML_NOERROR);
        $this->assertSame('', $document->querySelector('#sender-'.$sender->id.'-name')->getAttribute('value'));
        $this->assertSame($other->name, $document->querySelector('#sender-'.$other->id.'-name')->getAttribute('value'));
        $this->assertSame(2, $document->querySelectorAll('.sender-rename .field-error')->length);
    }

    /**
     * @return void
     */
    public function test_deactivation_prevents_subsequent_intake_even_on_existing_threads(): void
    {
        $sender = TrackedSender::query()->where('email', 'priya.nair@mail.example')->sole();
        $case = $sender->cases()->firstOrFail();
        $this->post(route('senders.deactivate', $sender))->assertRedirect();
        $this->assertFalse($sender->fresh()->is_active);
        $before = CaseMessage::query()->count();
        foreach ([$case->thread_id, 'brand-new-deactivated-thread'] as $thread) {
            $outcome = app(CaseIntake::class)->ingest(new IncomingMessage(
                gmailMessageId: 'deactivated-'.$thread,
                threadId: $thread,
                from: new SenderAddress(email: $sender->email, name: $sender->name),
                toEmail: config('casefile.owner.email'),
                subject: 'Ignored after deactivation',
                bodyText: 'Do not create or append a case.',
                receivedAt: CarbonImmutable::now(),
                attachments: [],
            ));
            $this->assertSame(IntakeResult::Ignored, $outcome->result);
        }
        $this->assertSame($before, CaseMessage::query()->count());
        $this->assertSame(16, CaseRecord::query()->count());
    }

    /**
     * @return void
     */
    public function test_reactivation_backfills_jade_untracked_threads_once_and_excludes_existing_cases(): void
    {
        $sender = TrackedSender::query()->where('email', 'jade.okafor@mail.example')->sole();
        MailboxMessage::factory()->create(['from_email' => $sender->email, 'thread_id' => 'jade-untracked-older', 'received_at' => CarbonImmutable::now()->subDays(4)]);
        MailboxMessage::factory()->create(['from_email' => $sender->email, 'thread_id' => 'jade-untracked-newer', 'received_at' => CarbonImmutable::now()->subDay()]);
        $existing = $sender->cases()->firstOrFail();
        $existingMessages = $existing->messages()->count();
        MailboxMessage::factory()->create(['from_email' => $sender->email, 'thread_id' => $existing->thread_id]);
        $this->post(route('senders.reactivate', $sender))->assertRedirect()->assertSessionHasNoErrors();
        $this->assertTrue($sender->fresh()->is_active);
        $this->assertSame(['jade-untracked-older', 'jade-untracked-newer'], $sender->cases()->whereIn('thread_id', ['jade-untracked-older', 'jade-untracked-newer'])->orderBy('number')->pluck('thread_id')->all());
        $this->assertSame($existingMessages, $existing->messages()->count());
        $after = CaseRecord::query()->count();
        $this->post(route('senders.reactivate', $sender))->assertRedirect();
        $this->assertSame($after, CaseRecord::query()->count());
    }

    /**
     * @return void
     */
    public function test_delete_with_cases_returns_exact_422_message_and_preserves_sender(): void
    {
        $sender = TrackedSender::query()->where('email', 'priya.nair@mail.example')->sole();
        $this->deleteJson(route('senders.destroy', $sender))->assertUnprocessable()->assertJsonPath('message', 'This sender has cases; deactivate it instead.');
        $this->delete(route('senders.destroy', $sender))->assertUnprocessable()->assertSee('This sender has cases; deactivate it instead.');
        $this->assertModelExists($sender);
        $this->assertTrue($sender->fresh()->is_active);
        $this->expectException(SenderHasCases::class);
        $this->expectExceptionMessage('This sender has cases; deactivate it instead.');
        app(DeleteTrackedSender::class)(sender: $sender);
    }

    /**
     * @return void
     */
    public function test_delete_sender_without_cases_removes_only_that_sender(): void
    {
        $this->post(route('senders.store'), ['email' => 'unused@mail.example', 'name' => 'Unused'])->assertRedirect();
        $sender = TrackedSender::query()->where('email', 'unused@mail.example')->sole();
        $this->delete(route('senders.destroy', $sender))->assertRedirect(route('settings').'#tracked-senders');
        $this->assertModelMissing($sender);
        $this->assertSame(5, TrackedSender::query()->count());
        $this->assertSame(16, CaseRecord::query()->count());
    }

    /**
     * @return void
     */
    public function test_settings_has_header_capable_required_fields_pending_forms_and_only_delete_confirmation(): void
    {
        $unused = TrackedSender::factory()->create(['name' => 'Unused', 'is_active' => false]);
        $response = $this->get(route('settings'))->assertOk()->assertSee('Connected mailbox: dana@casefile.example (simulated)')->assertDontSee(' style=', false);
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $email = $document->querySelector('#sender-email');
        $this->assertSame('text', $email->getAttribute('type'));
        $this->assertTrue($email->hasAttribute('required'));
        $this->assertTrue($document->querySelector('#sender-name')->hasAttribute('required'));
        $this->assertSame(2, $document->querySelectorAll('#add-sender .required-mark')->length);
        $this->assertSame(0, $document->querySelectorAll('.settings-page form:not([data-pending])')->length);
        $this->assertSame(0, $document->querySelectorAll('.settings-page form:not(:has(input[name="_token"]))')->length);
        $confirmations = $document->querySelectorAll('.settings-page [data-confirm]');
        $this->assertSame(1, $confirmations->length);
        $this->assertSame(route('senders.destroy', ['sender' => $unused, 'page' => 1]), $confirmations->item(0)->getAttribute('action'));
        $this->assertSame('DELETE', $confirmations->item(0)->querySelector('input[name="_method"]')->getAttribute('value'));
        foreach ($document->querySelectorAll('.sender-rename .form-actions') as $actions) {
            $this->assertSame('Cancel', trim($actions->firstElementChild->textContent));
            $this->assertSame('Save', trim($actions->lastElementChild->textContent));
        }
        $this->assertSame('page', $document->querySelector('a[href="'.route('settings').'"]')->getAttribute('aria-current'));
    }

    /**
     * @return void
     */
    public function test_mailbox_card_uses_configured_account_and_mode(): void
    {
        config(['casefile.owner.email' => 'other@casefile.example', 'casefile.mode' => 'production']);
        $card = $this->blade('<x-connected-mailbox-card />');
        $card->assertSee('Connected mailbox: other@casefile.example')->assertDontSee('(simulated)');
    }

    /**
     * @return void
     */
    public function test_senders_paginate_with_correct_total_and_page_two_rename_error_context(): void
    {
        foreach (range(1, 26) as $number) {
            TrackedSender::factory()->create(['name' => sprintf('ZZZ Sender %02d', $number)]);
        }
        $first = $this->get(route('settings'))->assertOk()->assertSee('31 senders.')->assertSee('Page 1 of 2');
        $this->assertCount(25, $first->viewData('senders'));
        $second = $this->get(route('settings', ['page' => 2]))->assertOk()->assertSee('Page 2 of 2');
        $this->assertCount(6, $second->viewData('senders'));
        $sender = $second->viewData('senders')->first();
        $this->patch(route('senders.update', ['sender' => $sender, 'page' => 2]), ['name' => '', 'label' => 'Draft label'])
            ->assertRedirect(route('settings', ['page' => 2]).'#sender-'.$sender->id)->assertSessionHasErrors(['name'], errorBag: 'renameSender'.$sender->id);
        $this->get(route('settings', ['page' => 2]))->assertOk()->assertSee('sender-'.$sender->id.'-name-error')->assertSee('Draft label');
        $this->get(route('settings', ['page' => 999]))->assertOk()->assertSee('No senders on this page.')->assertSee('31 senders.');
    }

    /**
     * @return array<string, array{string, string, int, int}>
     */
    public static function crossPageRenames(): array
    {
        return [
            'second page to first' => ['ZZZ Sender 21', 'AAA Sender', 2, 1],
            'first page to second' => ['ZZZ Sender 01', 'ZZZZ Sender', 1, 2],
        ];
    }

    /**
     * @param  string  $oldName
     * @param  string  $newName
     * @param  int  $submittedPage
     * @param  int  $destinationPage
     * @return void
     */
    #[DataProvider('crossPageRenames')]
    public function test_successful_rename_follows_sender_across_page_boundaries(string $oldName, string $newName, int $submittedPage, int $destinationPage): void
    {
        foreach (range(1, 26) as $number) {
            TrackedSender::factory()->create(['name' => sprintf('ZZZ Sender %02d', $number)]);
        }
        $sender = TrackedSender::query()->where('name', $oldName)->sole();
        $before = $this->get(route('settings', ['page' => $submittedPage]))->assertOk();
        $this->assertTrue($before->viewData('senders')->contains('id', $sender->id));
        $saved = $this->patch(route('senders.update', ['sender' => $sender, 'page' => $submittedPage]), ['name' => $newName, 'label' => 'Saved label'])
            ->assertRedirect(route('settings', ['page' => $destinationPage]).'#sender-'.$sender->id)->assertSessionHasNoErrors();
        $followed = $this->get($saved->headers->get('Location'))->assertOk()->assertSee($newName)->assertSee('Saved label');
        $this->assertSame($destinationPage, $followed->viewData('senders')->currentPage());
        $this->assertTrue($followed->viewData('senders')->contains('id', $sender->id));
        $document = HTMLDocument::createFromString($followed->getContent(), LIBXML_NOERROR);
        $anchor = parse_url($saved->headers->get('Location'), PHP_URL_FRAGMENT);
        $this->assertSame('sender-'.$sender->id, $anchor);
        $this->assertSame($newName, $document->getElementById($anchor)->querySelector('th > span')->textContent);
        $this->assertSame($newName, $sender->fresh()->name);
    }

    /**
     * @return array<string, array{int, int, string}>
     */
    public static function tiedSenderEdits(): array
    {
        return [
            'row 25 unchanged' => [19, 1, 'Original label'],
            'row 26 unchanged' => [20, 2, 'Original label'],
            'row 25 label only' => [19, 1, 'Changed label'],
            'row 26 label only' => [20, 2, 'Changed label'],
        ];
    }

    /**
     * @param  int  $tieIndex
     * @param  int  $expectedPage
     * @param  string  $label
     * @return void
     */
    #[DataProvider('tiedSenderEdits')]
    public function test_successful_unchanged_and_label_only_edits_preserve_name_id_boundary_order(int $tieIndex, int $expectedPage, string $label): void
    {
        $tiedSenders = TrackedSender::factory()->count(26)->create(['name' => 'ZZZ Same', 'label' => 'Original label']);
        $sender = $tiedSenders[$tieIndex];
        $saved = $this->patch(route('senders.update', ['sender' => $sender, 'page' => $expectedPage]), ['name' => 'ZZZ Same', 'label' => $label])
            ->assertRedirect(route('settings', ['page' => $expectedPage]).'#sender-'.$sender->id)->assertSessionHasNoErrors();
        $followed = $this->get($saved->headers->get('Location'))->assertOk();
        $paginator = $followed->viewData('senders');
        $boundary = $expectedPage === 1 ? $paginator->last() : $paginator->first();
        $this->assertSame($sender->id, $boundary->id);
        $document = HTMLDocument::createFromString($followed->getContent(), LIBXML_NOERROR);
        $row = $document->getElementById(parse_url($saved->headers->get('Location'), PHP_URL_FRAGMENT));
        $this->assertSame('ZZZ Same', $row->querySelector('th > span')->textContent);
        $this->assertSame($label, $row->querySelector('th')->lastElementChild->textContent);
    }

    /**
     * @return void
     */
    public function test_failed_rename_that_would_change_page_keeps_submitted_page_and_draft(): void
    {
        foreach (range(1, 26) as $number) {
            TrackedSender::factory()->create(['name' => sprintf('ZZZ Sender %02d', $number)]);
        }
        $sender = TrackedSender::query()->where('name', 'ZZZ Sender 21')->sole();
        $failed = $this->patch(route('senders.update', ['sender' => $sender, 'page' => 2]), ['name' => 'AAA Draft', 'label' => str_repeat('L', 61)])
            ->assertRedirect(route('settings', ['page' => 2]).'#sender-'.$sender->id)
            ->assertSessionHasErrors(['label'], errorBag: 'renameSender'.$sender->id)
            ->assertSessionHasInput('name', 'AAA Draft');
        $followed = $this->get($failed->headers->get('Location'))->assertOk();
        $this->assertSame(2, $followed->viewData('senders')->currentPage());
        $document = HTMLDocument::createFromString($followed->getContent(), LIBXML_NOERROR);
        $this->assertSame('AAA Draft', $document->querySelector('#sender-'.$sender->id.'-name')->getAttribute('value'));
        $this->assertTrue($document->querySelector('#sender-'.$sender->id.' details')->hasAttribute('open'));
        $this->assertSame('ZZZ Sender 21', $sender->fresh()->name);
        $this->assertSame(1, $document->querySelectorAll('.sender-rename .field-error')->length);
        $this->assertSame(0, $document->querySelectorAll('#add-sender .field-error')->length);
    }

    /**
     * @return array<string, array{string, string}>
     */
    public static function mutations(): array
    {
        return [
            'add' => ['POST', '/settings/senders'],
            'rename' => ['PATCH', '/settings/senders/1'],
            'deactivate' => ['POST', '/settings/senders/1/deactivate'],
            'reactivate' => ['POST', '/settings/senders/1/reactivate'],
            'delete' => ['DELETE', '/settings/senders/1'],
        ];
    }

    /**
     * @param  string  $method
     * @param  string  $path
     * @return void
     */
    #[DataProvider('mutations')]
    public function test_mutations_require_auth_and_real_csrf(string $method, string $path): void
    {
        $this->app['auth']->forgetGuards();
        $this->call($method, $path)->assertRedirect(route('sign-in'));
        $this->actingAs(User::query()->sole());
        $this->app['env'] = 'csrf-check';
        $this->withSession(['_token' => 'expected-token'])->call($method, $path)->assertStatus(419);
    }

    /**
     * @return void
     */
    public function test_guest_cannot_open_settings(): void
    {
        $this->app['auth']->forgetGuards();
        $this->get(route('settings'))->assertRedirect(route('sign-in'));
    }

    /**
     * @return void
     */
    public function test_unknown_ids_return_404_and_mutations_reuse_case_action_limiter(): void
    {
        $this->patch('/settings/senders/99999', ['name' => 'No sender'])->assertNotFound();
        $this->delete('/settings/senders/not-a-number')->assertNotFound();
        config(['casefile.actions.attempts_per_minute' => 2]);
        $this->travel(1)->minute();
        $this->post('/settings/senders/1/deactivate')->assertRedirect();
        $this->post('/notifications/read')->assertRedirect();
        $this->post('/settings/senders', ['email' => 'blocked@mail.example', 'name' => 'Blocked'])->assertTooManyRequests()->assertHeader('Retry-After');
        $this->assertDatabaseMissing('tracked_senders', ['email' => 'blocked@mail.example']);
    }

    /**
     * @return array<string, array{bool}>
     */
    public static function atomicMutations(): array
    {
        return ['add' => [false], 'reactivate' => [true]];
    }

    /**
     * @param  bool  $reactivate
     * @return void
     */
    #[DataProvider('atomicMutations')]
    public function test_sender_change_and_all_backfill_effects_roll_back_after_second_notification_fails(bool $reactivate): void
    {
        $sender = $reactivate ? TrackedSender::factory()->create(['email' => 'atomic@mail.example', 'is_active' => false]) : null;
        foreach ([3, 2] as $daysAgo) {
            MailboxMessage::factory()->create(['from_email' => 'atomic@mail.example', 'received_at' => CarbonImmutable::now()->subDays($daysAgo)]);
        }
        $mailboxCount = MailboxMessage::query()->count();
        $messageCount = CaseMessage::query()->count();
        $eventCount = CaseEvent::query()->count();
        $notificationCount = DB::table('notifications')->count();
        $sequence = CaseNumberSequence::query()->sole()->next_number;
        $real = app(SimulatedMailbox::class);
        $connector = Mockery::mock(MailboxConnector::class);
        $connector->shouldReceive('backfill')->once()->andReturnUsing(fn (SenderAddress $address) => $real->backfill($address));
        $sendCount = 0;
        $connector->shouldReceive('send')->twice()->andReturnUsing(function (OutgoingReply $reply) use ($real, &$sendCount): SentReply {
            $sendCount++;
            if ($sendCount === 2) {
                $this->assertSame(18, CaseRecord::query()->count());
                throw new RuntimeException('Second notification failed.');
            }

            return $real->send($reply);
        });
        $this->app->instance(MailboxConnector::class, $connector);

        try {
            if ($reactivate) {
                app(ReactivateTrackedSender::class)(sender: $sender);
            } else {
                app(AddTrackedSender::class)(emailHeader: 'Atomic <ATOMIC@MAIL.EXAMPLE>', name: 'Atomic', label: null);
            }
            $this->fail('The failed backfill must throw.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Second notification failed.', $exception->getMessage());
        }

        $this->assertSame(2, $sendCount);
        $this->assertSame(16, CaseRecord::query()->count());
        $this->assertSame($messageCount, CaseMessage::query()->count());
        $this->assertSame($eventCount, CaseEvent::query()->count());
        $this->assertSame($mailboxCount, MailboxMessage::query()->count());
        $this->assertSame($notificationCount, DB::table('notifications')->count());
        $this->assertSame($sequence, CaseNumberSequence::query()->sole()->next_number);
        if ($reactivate) {
            $this->assertFalse($sender->fresh()->is_active);
        } else {
            $this->assertDatabaseMissing('tracked_senders', ['email' => 'atomic@mail.example']);
        }
    }
}
