<?php

namespace Tests\Feature;

use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Enums\MessageDirection;
use App\Models\Attachment;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\User;
use Carbon\CarbonImmutable;
use Dom\Element;
use Dom\HTMLDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class CaseShowTest extends TestCase
{
    use RefreshDatabase;

    private const string NOW = '2026-10-14 15:00:00';

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->withCookie(config('casefile.layout.cookie'), 'desk');
        $this->travelTo(CarbonImmutable::parse(self::NOW, 'America/Toronto'));
        $this->seed();
        $this->actingAs(User::query()->findOrFail(1));
    }

    /**
     * @return array<string, array{string}>
     */
    public static function unknownNumbers(): array
    {
        return [
            'never allocated' => ['CASE-9999'],
            'trailing junk' => ['CASE-0016x'],
            'no prefix' => ['0016'],
            'database id' => ['16'],
        ];
    }

    /**
     * @see routes/web.php
     */
    public function test_a_guest_is_sent_to_sign_in(): void
    {
        $this->app['auth']->forgetGuards();

        $this->get('/cases/CASE-0016')->assertRedirect('/sign-in');
        $this->get('/cases/CASE-9999')->assertRedirect('/sign-in');
    }

    /**
     * @see routes/web.php
     */
    #[DataProvider('unknownNumbers')]
    public function test_an_unknown_case_number_is_not_found(string $number): void
    {
        $this->get('/cases/'.$number)->assertNotFound();
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_the_thread_shows_messages_oldest_first_with_direction_marks(): void
    {
        $document = $this->document($this->get('/cases/CASE-0003')->assertOk());

        $messages = $document->querySelectorAll('ol.thread > li.message');

        $this->assertSame(
            CaseMessage::query()
                ->whereRelation('case', 'number', 'CASE-0003')
                ->orderBy('sent_at')
                ->get()
                ->map(fn (CaseMessage $message): string => ($message->direction === MessageDirection::Outbound ? 'Sent' : 'Received').': '.Str::words(Str::squish($message->body_text), 5, ''))
                ->all(),
            array_values(array_filter($this->thread($document), fn (string $entry): bool => ! str_starts_with($entry, 'Event: '))),
        );
        $this->assertSame([
            'Received: Hi Dana, Would it be',
            'Sent: Hi Marcus, That\'s fine with',
            'Received: Hi Dana, Priya says she\'s',
            'Sent: Hi Marcus, Priya confirmed when',
        ], array_values(array_filter($this->thread($document), fn (string $entry): bool => ! str_starts_with($entry, 'Event: '))));
        $this->assertSame('Marcus Leblanc', trim($messages->item(0)->querySelector('.message-name')->textContent));
        $this->assertSame('marcus.leblanc@mail.example', trim($messages->item(0)->querySelector('.message-address')->textContent));
        $this->assertFalse($messages->item(0)->classList->contains('message-outbound'));
        $this->assertSame('You · sent via Gmail (simulated)', trim($messages->item(1)->querySelector('.message-name')->textContent));
        $this->assertNull($messages->item(1)->querySelector('.message-address'));
        $this->assertTrue($messages->item(1)->classList->contains('message-outbound'));
        $this->assertSame('DW', trim($messages->item(1)->querySelector('.avatar')->textContent));
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_the_thread_interleaves_status_changes_and_messages_by_time(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0004')->firstOrFail();
        $moved = $case->events()->where('to_status', CaseStatus::InProgress)->firstOrFail();
        $lastMessage = $case->messages()->get()->last();

        $this->assertTrue($moved->occurred_at->lessThan($lastMessage->sent_at));
        $this->assertTrue($moved->occurred_at->greaterThan($case->messages()->get()->get(1)->sent_at));

        $document = $this->document($this->get('/cases/CASE-0004')->assertOk());

        $this->assertSame([
            'Received: Hi Dana, This is a',
            'Sent: Hi Rob, That time works.',
            'Event: Status changed from Open to In progress',
            'Received: Hi Dana, The start-up is',
            'Event: Status changed from In progress to Closed',
        ], $this->thread($document));
    }

    /**
     * @see resources/views/workspace/desk/show.blade.php
     */
    public function test_the_case_heading_comes_before_the_list_heading(): void
    {
        $document = $this->document($this->get('/cases/CASE-0004')->assertOk());

        $headings = $document->querySelectorAll('main h1, main h2');

        $this->assertSame('H1', $headings->item(0)->tagName);
        $this->assertSame('case-heading', $headings->item(0)->getAttribute('id'));
        $this->assertSame(1, $document->querySelectorAll('main h1')->length);
        $this->assertNotNull($document->querySelector('.desk-show > .desk-detail + .desk-folders + .desk-list'));
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_the_thread_hides_events_that_only_echo_a_message(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0004')->firstOrFail();

        $this->assertSame(
            [CaseEventKind::Created, CaseEventKind::ReplySent, CaseEventKind::StatusChanged, CaseEventKind::MessageReceived, CaseEventKind::StatusChanged],
            $case->events()->pluck('kind')->all(),
        );

        $thread = $this->document($this->get('/cases/CASE-0004')->assertOk())->querySelector('ol.thread')->textContent;

        $this->assertStringNotContainsString(CaseEventKind::Created->label(), $thread);
        $this->assertStringNotContainsString(CaseEventKind::ReplySent->label(), $thread);
        $this->assertStringNotContainsString(CaseEventKind::MessageReceived->label(), $thread);
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_a_reopen_shows_between_the_messages_it_falls_between(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0001')->firstOrFail();
        $messages = $case->messages()->get();
        $case->events()->create([
            'kind' => CaseEventKind::Reopened,
            'from_status' => CaseStatus::Closed,
            'to_status' => CaseStatus::Open,
            'occurred_at' => $messages->get(0)->sent_at->addMinute(),
        ]);

        $document = $this->document($this->get('/cases/CASE-0001')->assertOk());

        $this->assertSame([
            'Received: Hi Dana, The latch on',
            'Event: Case reopened from Closed to Open',
            'Sent: Hi Jade, Thanks for letting',
            'Event: Status changed from Open to In progress',
            'Event: Status changed from In progress to Closed',
        ], $this->thread($document));
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_a_message_stored_later_but_sent_earlier_sorts_by_its_send_time(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0016')->firstOrFail();
        CaseMessage::factory()->create([
            'case_id' => $case->id,
            'body_text' => 'Earlier note that arrived in the database last.',
            'sent_at' => $case->received_at->subHour(),
        ]);

        $document = $this->document($this->get('/cases/CASE-0016')->assertOk());

        $this->assertSame([
            'Received: Earlier note that arrived in',
            'Received: Hi Dana, The heat in',
        ], $this->thread($document));
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_message_dates_and_times_render_in_toronto_time(): void
    {
        $document = $this->document($this->get('/cases/CASE-0016')->assertOk());

        $time = $document->querySelector('ol.thread > li.message time');

        $this->assertSame('Oct 14, 2026 · 1:25 pm', trim($time->textContent));
        $this->assertSame('2026-10-14T13:25:00-04:00', $time->getAttribute('datetime'));
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_outbound_messages_carry_the_simulated_mark_in_local_mode(): void
    {
        $this->assertSame('local', config('casefile.mode'));

        $document = $this->document($this->get('/cases/CASE-0014')->assertOk());

        $outbound = $document->querySelectorAll('ol.thread > li.message-outbound');

        $this->assertSame(1, $outbound->length);
        $this->assertSame('You · sent via Gmail (simulated)', trim($outbound->item(0)->querySelector('.message-name')->textContent));
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_production_mode_drops_the_simulated_mark(): void
    {
        config(['casefile.mode' => 'production']);

        $response = $this->get('/cases/CASE-0014')->assertOk();
        $document = $this->document($response);

        $this->assertSame('You · sent via Gmail', trim($document->querySelector('ol.thread > li.message-outbound .message-name')->textContent));
        $response->assertDontSee('(simulated)');
    }

    /**
     * @see resources/views/components/attachment-chip.blade.php
     */
    public function test_attachments_appear_as_chips_on_their_message(): void
    {
        $document = $this->document($this->get('/cases/CASE-0016')->assertOk());
        $attachment = Attachment::query()->where('filename', 'thermostat-error.png')->firstOrFail();

        $chips = $document->querySelectorAll('ol.thread > li.message .attachment-list a.attachment-chip');

        $this->assertSame(1, $chips->length);
        $this->assertSame(route('attachments.show', $attachment), $chips->item(0)->getAttribute('href'));
        $this->assertSame('thermostat-error.png', trim($chips->item(0)->querySelector('.attachment-chip-name')->textContent));
        $this->assertSame('_blank', $chips->item(0)->getAttribute('target'));
        $this->assertSame('noopener', $chips->item(0)->getAttribute('rel'));
        $this->assertStringContainsString('(opens in a new tab)', $chips->item(0)->textContent);
    }

    /**
     * @see resources/views/components/attachment-chip.blade.php
     */
    public function test_a_case_without_attachments_shows_no_chips(): void
    {
        $document = $this->document($this->get('/cases/CASE-0004')->assertOk());

        $this->assertNull($document->querySelector('.attachment-chip'));
        $this->assertNull($document->querySelector('.attachment-list'));
    }

    /**
     * @return void
     */
    public function test_shared_details_form_has_one_accessible_sheet_and_wide_rail_host(): void
    {
        $document = $this->document($this->get('/cases/CASE-0014')->assertOk());
        $sheet = $document->querySelector('.desk-detail > dialog.case-edit-rail');
        $this->assertSame('case-editor', $sheet->id);
        $this->assertSame('case-editor-heading', $sheet->getAttribute('aria-labelledby'));
        $this->assertSame('Manage case', $sheet->querySelector('#case-editor-heading')->textContent);
        $this->assertSame('false', $sheet->getAttribute('data-has-errors'));
        $opener = $document->querySelector('[data-details-open]');
        $this->assertSame('case-editor', $opener->getAttribute('aria-controls'));
        $this->assertSame('dialog', $opener->getAttribute('aria-haspopup'));
        $this->assertSame('#case-details', $opener->getAttribute('href'));
        $this->assertSame('button', $sheet->querySelector('[data-details-close]')->getAttribute('type'));
        $this->assertSame(1, $document->querySelectorAll('#case-details')->length);
        $this->assertSame('-1', $sheet->querySelector('#case-details')->getAttribute('tabindex'));
        $this->assertTrue($sheet->querySelector('#case-details')->hasAttribute('data-draft-form'));
        $this->assertSame(3, $sheet->querySelectorAll('[data-original-value]')->length);
        $this->assertNotNull($document->querySelector('.desk-detail > .desk-thread'));
        $this->assertNotNull($document->querySelector('.desk-detail > #reply-composer'));
    }

    /**
     * @see resources/views/workspace/desk/show.blade.php
     */
    public function test_the_details_strip_shows_the_case_facts_read_only(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0014')->firstOrFail();

        $document = $this->document($this->get('/cases/CASE-0014')->assertOk());
        $strip = $document->querySelector('.details-strip.glass');

        $this->assertSame([
            'Case' => 'CASE-0014',
            'Status' => 'In progress',
            'Received' => 'Oct 10, 2026',
            'Sender' => 'Marcus Leblanc marcus.leblanc@mail.example Tenant, unit 3A Tracked',
            'Issue' => $case->issue,
            'Notes' => $case->notes,
        ], $this->facts($strip));
        $this->assertNull($strip->querySelector('form, input, textarea, select, button'));
        $this->assertSame('Kitchen sink leaking, unit 3A', trim($document->querySelector('h1.detail-title')->textContent));
        $this->assertSame('CASE-0014 Kitchen sink leaking, unit 3A · Casefile', $document->title);
    }

    /**
     * @see resources/views/workspace/desk/show.blade.php
     */
    public function test_a_closed_case_from_an_inactive_sender_says_so(): void
    {
        $document = $this->document($this->get('/cases/CASE-0005')->assertOk());

        $facts = $this->facts($document->querySelector('.details-strip'));

        $this->assertSame('Closed', $facts['Status']);
        $this->assertSame('Sep 16, 2026', $facts['Closed']);
        $this->assertSame('2026-09-16 10:00:00', CaseRecord::query()->where('number', 'CASE-0005')->firstOrFail()->closed_at->format('Y-m-d H:i:s'));
        $this->assertStringEndsWith('No longer tracked', $facts['Sender']);
        $this->assertStringNotContainsString(' Tracked', $facts['Sender']);
    }

    /**
     * @see resources/views/workspace/desk/show.blade.php
     */
    public function test_an_empty_issue_and_notes_say_nothing_is_noted(): void
    {
        $facts = $this->facts($this->document($this->get('/cases/CASE-0016')->assertOk())->querySelector('.details-strip'));

        $this->assertSame('Nothing noted yet.', $facts['Issue']);
        $this->assertSame('Nothing noted yet.', $facts['Notes']);
        $this->assertArrayNotHasKey('Closed', $facts);
    }

    /**
     * @see resources/views/workspace/desk/show.blade.php
     */
    public function test_the_list_beside_the_thread_keeps_its_folder_and_marks_the_open_case(): void
    {
        $document = $this->document($this->get('/cases/CASE-0003?status=closed')->assertOk());

        $rows = $document->querySelectorAll('.desk-list a.case-row');
        $active = $document->querySelectorAll('.desk-list a.case-row[aria-current="page"]');

        $this->assertSame(CaseRecord::query()->where('status', CaseStatus::Closed)->count(), $rows->length);
        $this->assertSame(1, $active->length);
        $this->assertSame(route('cases.show', ['case' => 'CASE-0003', 'status' => 'closed']), $active->item(0)->getAttribute('href'));
        $this->assertTrue($active->item(0)->classList->contains('is-active'));
        $this->assertSame(route('home', ['status' => 'closed']), $document->querySelector('a.back-link')->getAttribute('href'));
        $this->assertTrue($document->querySelector('a.back-link')->hasAttribute('data-pending'));
        $this->assertSame('true', $document->querySelector('.folder-link[aria-current]')->getAttribute('aria-current'));
        $this->assertSame('Closed', trim($document->querySelector('.folder-link[aria-current] .folder-name')->textContent));
        $this->assertSame('true', $document->querySelector('.app-nav a')->getAttribute('aria-current'));
    }

    /**
     * @see resources/views/workspace/desk/show.blade.php
     */
    public function test_a_case_outside_the_listed_folder_still_opens(): void
    {
        $document = $this->document($this->get('/cases/CASE-0016?status=closed&page[]=2')->assertOk());

        $this->assertNull($document->querySelector('.desk-list a.case-row[aria-current]'));
        $this->assertSame('Boiler not firing, unit 2B', trim($document->querySelector('h1.detail-title')->textContent));
        $this->assertNotNull($document->querySelector('.desk.desk-show > .desk-folders'));
        $this->assertNotNull($document->querySelector('.desk.desk-show > .desk-list'));
        $this->assertNotNull($document->querySelector('.desk.desk-show > .desk-detail ol.thread'));
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_a_message_without_a_display_name_falls_back_to_the_address(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0013')->firstOrFail();
        CaseMessage::factory()->create([
            'case_id' => $case->id,
            'from_name' => null,
            'from_email' => 'office@dufferinplumbing.example',
            'sent_at' => $case->received_at->addHour(),
        ]);

        $document = $this->document($this->get('/cases/CASE-0013')->assertOk());
        $last = $document->querySelectorAll('ol.thread > li.message')->item(1);

        $this->assertSame('office@dufferinplumbing.example', trim($last->querySelector('.message-name')->textContent));
        $this->assertNull($last->querySelector('.message-address'));
        $this->assertSame('O', trim($last->querySelector('.avatar')->textContent));
    }

    /**
     * @see App\View\Components\CaseThread
     */
    public function test_message_and_case_text_is_escaped(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0016')->firstOrFail();
        $case->update(['subject' => '<script>alert(1)</script>', 'issue' => '<b>bold</b>']);
        $case->messages()->firstOrFail()->update([
            'body_text' => '<img src=x onerror=alert(1)>',
            'from_name' => '<i>Priya</i>',
        ]);

        $response = $this->get('/cases/CASE-0016')->assertOk();

        $response->assertDontSee('<script>alert(1)</script>', false);
        $response->assertDontSee('<img src=x onerror=alert(1)>', false);
        $response->assertDontSee('<b>bold</b>', false);
        $response->assertDontSee('<i>Priya</i>', false);
        $response->assertSee('&lt;img src=x onerror=alert(1)&gt;', false);
    }

    /**
     * @see App\Http\Controllers\CaseController::show()
     */
    public function test_the_case_page_does_not_query_once_per_message(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0016')->firstOrFail();
        CaseMessage::factory()
            ->count(6)
            ->has(Attachment::factory()->count(2))
            ->create(['case_id' => $case->id, 'sent_at' => $case->received_at->addMinutes(5)]);

        DB::enableQueryLog();
        $this->get('/cases/CASE-0016')->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertLessThanOrEqual(10, $queries);
    }

    /**
     * @param  TestResponse  $response
     * @return HTMLDocument
     */
    private function document(TestResponse $response): HTMLDocument
    {
        return HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
    }

    /**
     * @param  HTMLDocument  $document
     * @return list<string>
     */
    private function thread(HTMLDocument $document): array
    {
        $entries = [];

        foreach ($document->querySelectorAll('ol.thread > li') as $item) {
            if ($item->classList->contains('message')) {
                $entries[] = trim($item->querySelector('.message-mark')->textContent).': '.Str::words(Str::squish($item->querySelector('.message-body')->textContent), 5, '');

                continue;
            }

            $time = $item->querySelector('time')->textContent;
            $entries[] = 'Event: '.Str::squish(str_replace($time, '', $item->textContent));
        }

        return $entries;
    }

    /**
     * @param  Element  $strip
     * @return array<string, string>
     */
    private function facts(Element $strip): array
    {
        $facts = [];

        foreach ($strip->querySelectorAll('dl > div') as $fact) {
            $facts[trim($fact->querySelector('dt')->textContent)] = Str::squish($fact->querySelector('dd')->textContent);
        }

        return $facts;
    }
}
