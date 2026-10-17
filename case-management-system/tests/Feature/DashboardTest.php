<?php

namespace Tests\Feature;

use App\Enums\CaseStatus;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\User;
use Carbon\CarbonImmutable;
use Dom\Element;
use Dom\HTMLDocument;
use Illuminate\Database\Eloquent\Factories\Sequence;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class DashboardTest extends TestCase
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
     * @return array<string, array{CaseStatus}>
     */
    public static function statuses(): array
    {
        return [
            'open' => [CaseStatus::Open],
            'in progress' => [CaseStatus::InProgress],
            'closed' => [CaseStatus::Closed],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function ignoredStatusQueries(): array
    {
        return [
            'unknown word' => ['/?status=archived'],
            'label instead of value' => ['/?status=In+progress'],
            'upper case value' => ['/?status=OPEN'],
            'empty value' => ['/?status='],
            'array value' => ['/?status[]=open'],
            'nested array value' => ['/?status[open][]=closed'],
            'markup' => ['/?status=%3Cscript%3E'],
        ];
    }

    /**
     * @see routes/web.php
     */
    public function test_a_guest_is_sent_to_sign_in(): void
    {
        $this->app['auth']->forgetGuards();

        $this->get('/')->assertRedirect('/sign-in');
        $this->get('/?status=closed&page=2')->assertRedirect('/sign-in');
    }

    /**
     * @see App\Queries\CaseListQuery::paginate()
     */
    public function test_seeded_cases_list_newest_received_first(): void
    {
        $document = $this->document($this->get('/')->assertOk());

        $expected = CaseRecord::query()->orderByDesc('received_at')->pluck('number')->all();

        $this->assertSame('CASE-0016', $this->listedNumbers($document)[0]);
        $this->assertSame($expected, $this->listedNumbers($document));
        $this->assertSame(array_map(fn (int $number): string => sprintf('CASE-%04d', $number), range(16, 1)), $expected);
    }

    /**
     * @see App\Data\StatusCounts::fromDatabase()
     */
    public function test_folder_counts_equal_the_database_per_status(): void
    {
        $document = $this->document($this->get('/')->assertOk());

        $this->assertSame([
            'All cases' => CaseRecord::query()->count(),
            'Open' => CaseRecord::query()->where('status', CaseStatus::Open)->count(),
            'In progress' => CaseRecord::query()->where('status', CaseStatus::InProgress)->count(),
            'Closed' => CaseRecord::query()->where('status', CaseStatus::Closed)->count(),
        ], $this->folderCounts($document));
        $this->assertSame(['All cases' => 16, 'Open' => 5, 'In progress' => 2, 'Closed' => 9], $this->folderCounts($document));
    }

    /**
     * @see App\Data\StatusCounts::fromDatabase()
     */
    public function test_counts_follow_a_status_change_in_the_database(): void
    {
        CaseRecord::query()->where('number', 'CASE-0016')->update(['status' => CaseStatus::Closed]);

        $document = $this->document($this->get('/')->assertOk());

        $this->assertSame(['All cases' => 16, 'Open' => 4, 'In progress' => 2, 'Closed' => 10], $this->folderCounts($document));
    }

    /**
     * @see App\Queries\CaseListQuery::paginate()
     */
    public function test_the_closed_folder_lists_only_closed_cases_and_its_count_matches(): void
    {
        $document = $this->document($this->get('/?status=closed')->assertOk());

        $expected = CaseRecord::query()
            ->where('status', CaseStatus::Closed)
            ->orderByDesc('received_at')
            ->pluck('number')
            ->all();

        $this->assertSame($expected, $this->listedNumbers($document));
        $this->assertCount(9, $expected);
        $this->assertSame(CaseRecord::query()->where('status', CaseStatus::Closed)->count(), $this->folderCounts($document)['Closed']);
        $this->assertSame('Closed', trim($document->querySelector('.desk-list-heading')->textContent));
        $this->assertSame('Closed · Casefile', $document->title);
        $this->assertSame(['Closed'], $this->currentFolders($document));
        $this->assertNotContains('CASE-0016', $this->listedNumbers($document));
    }

    /**
     * @see App\Queries\CaseListQuery::paginate()
     */
    #[DataProvider('statuses')]
    public function test_every_folder_lists_exactly_its_cases_and_the_count_agrees(CaseStatus $status): void
    {
        $document = $this->document($this->get('/?status='.$status->value)->assertOk());

        $listed = $this->listedNumbers($document);

        $this->assertSame(
            CaseRecord::query()->where('status', $status)->orderByDesc('received_at')->pluck('number')->all(),
            $listed,
        );
        $this->assertSame(count($listed), $this->folderCounts($document)[$status->label()]);
        $this->assertSame([$status->label()], $this->currentFolders($document));

        foreach ($document->querySelectorAll('.case-rows .pill') as $pill) {
            $this->assertSame($status->label(), trim($pill->textContent));
            $this->assertStringContainsString($status->pillClass(), $pill->getAttribute('class'));
        }
    }

    /**
     * @see App\Queries\CaseListQuery::fromRequest()
     */
    #[DataProvider('ignoredStatusQueries')]
    public function test_an_unusable_status_value_is_ignored(string $uri): void
    {
        $document = $this->document($this->get($uri)->assertOk());

        $this->assertCount(16, $this->listedNumbers($document));
        $this->assertSame('All cases', trim($document->querySelector('.desk-list-heading')->textContent));
        $this->assertSame(['All cases'], $this->currentFolders($document));
        $this->assertNull($document->querySelector('.pagination'));
    }

    /**
     * @see resources/views/components/pagination.blade.php
     */
    public function test_twenty_six_cases_paginate_to_a_second_page(): void
    {
        $this->createOlderCases(10, []);
        $expected = CaseRecord::query()->orderByDesc('received_at')->orderByDesc('id')->pluck('number')->all();
        $this->assertCount(26, $expected);

        $first = $this->document($this->get('/')->assertOk());

        $this->assertSame(array_slice($expected, 0, 25), $this->listedNumbers($first));
        $this->assertSame('CASE-0016', $this->listedNumbers($first)[0]);
        $this->assertSame('Page 1 of 2', trim($first->querySelector('.pagination-status')->textContent));
        $this->assertNull($first->querySelector('a.pagination-link[rel="prev"]'));
        $next = $first->querySelector('a.pagination-link[rel="next"]');
        $this->assertSame(url('/').'?page=2', $next->getAttribute('href'));
        $this->assertTrue($next->hasAttribute('data-pending'));
        $this->assertSame(26, $this->folderCounts($first)['All cases']);

        $second = $this->document($this->get('/?page=2')->assertOk());

        $this->assertSame(array_slice($expected, 25), $this->listedNumbers($second));
        $this->assertSame('Page 2 of 2', trim($second->querySelector('.pagination-status')->textContent));
        $this->assertSame(url('/').'?page=1', $second->querySelector('a.pagination-link[rel="prev"]')->getAttribute('href'));
        $this->assertNull($second->querySelector('a.pagination-link[rel="next"]'));
        $this->assertSame('Next', trim($second->querySelector('span.pagination-link-off')->textContent));
        $this->assertSame('Previous', trim($first->querySelector('span.pagination-link-off')->textContent));
        $this->assertNull($first->querySelector('.pagination [aria-disabled]'));
        $this->assertNull($second->querySelector('.pagination [aria-disabled]'));
    }

    /**
     * @see App\Queries\CaseListQuery::paginate()
     */
    public function test_pagination_links_keep_the_status_and_drop_unknown_parameters(): void
    {
        $this->createOlderCases(20, ['status' => CaseStatus::Closed]);

        $first = $this->document($this->get('/?status=closed&noise=%3Cb%3E')->assertOk());

        $this->assertCount(25, $this->listedNumbers($first));
        $this->assertSame(29, $this->folderCounts($first)['Closed']);
        $this->assertSame(url('/').'?status=closed&page=2', $first->querySelector('a.pagination-link[rel="next"]')->getAttribute('href'));

        $second = $this->document($this->get('/?status=closed&page=2')->assertOk());

        $this->assertCount(4, $this->listedNumbers($second));
        $this->assertSame(
            CaseRecord::query()->where('status', CaseStatus::Closed)->orderByDesc('received_at')->orderByDesc('id')->pluck('number')->slice(25)->values()->all(),
            $this->listedNumbers($second),
        );
    }

    /**
     * @see resources/views/components/case-row.blade.php
     */
    public function test_rows_on_a_later_page_link_back_with_their_list_context(): void
    {
        $this->createOlderCases(20, ['status' => CaseStatus::Closed]);

        $document = $this->document($this->get('/?status=closed&page=2')->assertOk());

        foreach ($document->querySelectorAll('a.case-row') as $row) {
            $this->assertMatchesRegularExpression('~/cases/CASE-\d{4}\?status=closed&page=2$~', $row->getAttribute('href'));
        }
    }

    /**
     * @see resources/views/components/case-list.blade.php
     */
    public function test_a_page_past_the_end_offers_the_first_page(): void
    {
        $document = $this->document($this->get('/?status=open&page=9')->assertOk());

        $this->assertSame([], $this->listedNumbers($document));
        $this->assertStringContainsString('This page is past the end of the list.', $document->querySelector('.desk-list')->textContent);
        $this->assertSame(url('/').'?status=open&page=1', $document->querySelector('.desk-list .empty-state a')->getAttribute('href'));
        $this->assertNull($document->querySelector('.pagination'));
        $this->assertSame(5, $this->folderCounts($document)['Open']);
    }

    /**
     * @see resources/views/components/empty-state.blade.php
     */
    public function test_an_installation_without_cases_shows_the_empty_state(): void
    {
        CaseRecord::query()->delete();

        $document = $this->document($this->get('/')->assertOk());

        $this->assertSame([], $this->listedNumbers($document));
        $this->assertSame('No cases here yet.', trim($document->querySelector('.desk-list .empty-state-title')->textContent));
        $this->assertSame(['All cases' => 0, 'Open' => 0, 'In progress' => 0, 'Closed' => 0], $this->folderCounts($document));
    }

    /**
     * @see resources/views/components/case-row.blade.php
     */
    public function test_a_row_shows_sender_subject_snippet_date_pill_and_attachment_mark(): void
    {
        $document = $this->document($this->get('/')->assertOk());

        $row = $this->row($document, 'CASE-0016');

        $this->assertSame('Priya Nair', trim($row->querySelector('.case-row-sender')->textContent));
        $this->assertSame('PN', trim($row->querySelector('.avatar')->textContent));
        $this->assertSame('true', $row->querySelector('.avatar')->getAttribute('aria-hidden'));
        $this->assertSame('Boiler not firing, unit 2B', trim($row->querySelector('.case-row-subject')->textContent));
        $snippet = $row->querySelector('.case-row-snippet')->textContent;
        $body = Str::squish(CaseMessage::query()->where('gmail_message_id', 'msg-0016-01')->value('body_text'));
        $this->assertStringStartsWith('Hi Dana, The heat in 2B stopped sometime overnight', $snippet);
        $this->assertStringEndsWith('...', $snippet);
        $this->assertStringStartsWith(Str::beforeLast($snippet, '...'), $body);
        $this->assertSame(' ', mb_substr($body, mb_strlen(Str::beforeLast($snippet, '...')), 1));
        $this->assertCount(24, explode(' ', Str::beforeLast($snippet, '...')));
        $this->assertStringNotContainsString("\n", $snippet);
        $this->assertSame('Today', trim($row->querySelector('.case-row-date')->textContent));
        $this->assertStringStartsWith('2026-10-14T13:25:00', $row->querySelector('.case-row-date')->getAttribute('datetime'));
        $this->assertSame('Open', trim($row->querySelector('.pill')->textContent));
        $this->assertSame('Has attachments', trim($row->querySelector('.case-row-clip')->textContent));
        $this->assertSame(route('cases.show', ['case' => 'CASE-0016']), $row->getAttribute('href'));
        $this->assertTrue($row->hasAttribute('data-pending'));
        $this->assertFalse($row->hasAttribute('aria-current'));
    }

    /**
     * @see resources/views/components/case-row.blade.php
     */
    public function test_older_rows_show_a_short_date_and_outbound_snippets_start_with_you(): void
    {
        $document = $this->document($this->get('/')->assertOk());

        $this->assertSame('Oct 12', trim($this->row($document, 'CASE-0015')->querySelector('.case-row-date')->textContent));
        $this->assertSame('Oct 10', trim($this->row($document, 'CASE-0014')->querySelector('.case-row-date')->textContent));
        $this->assertStringStartsWith('You: Hi Marcus, Thanks for the photo', $this->row($document, 'CASE-0014')->querySelector('.case-row-snippet')->textContent);
        $this->assertSame('In progress', trim($this->row($document, 'CASE-0014')->querySelector('.pill')->textContent));
        $this->assertNull($this->row($document, 'CASE-0013')->querySelector('.case-row-clip'));
    }

    /**
     * @see resources/views/components/case-row.blade.php
     */
    public function test_a_snippet_stays_short_even_for_one_endless_word(): void
    {
        CaseMessage::query()->where('gmail_message_id', 'msg-0016-01')->update(['body_text' => str_repeat('a', 5000)]);

        $snippet = $this->row($this->document($this->get('/')->assertOk()), 'CASE-0016')->querySelector('.case-row-snippet')->textContent;

        $this->assertSame(str_repeat('a', 200).'...', $snippet);
    }

    /**
     * @see resources/views/components/case-row.blade.php
     */
    public function test_a_case_received_yesterday_says_yesterday(): void
    {
        CaseRecord::query()->where('number', 'CASE-0016')->update(['received_at' => '2026-10-13 23:59:00']);
        CaseRecord::query()->where('number', 'CASE-0015')->update(['received_at' => '2026-10-14 00:00:00']);

        $document = $this->document($this->get('/')->assertOk());

        $this->assertSame('Yesterday', trim($this->row($document, 'CASE-0016')->querySelector('.case-row-date')->textContent));
        $this->assertSame('Today', trim($this->row($document, 'CASE-0015')->querySelector('.case-row-date')->textContent));
    }

    /**
     * @see resources/views/components/case-list.blade.php
     */
    public function test_every_list_link_carries_the_pending_mark(): void
    {
        $this->createOlderCases(10, []);

        $document = $this->document($this->get('/')->assertOk());

        $links = $document->querySelectorAll('.desk-folders a, .desk-list a');

        $this->assertGreaterThan(25, $links->length);

        foreach ($links as $link) {
            $this->assertTrue($link->hasAttribute('data-pending'), $link->getAttribute('href'));
        }
    }

    /**
     * @see resources/views/workspace/desk/index.blade.php
     */
    public function test_the_index_shows_the_list_and_a_wide_screen_placeholder(): void
    {
        $document = $this->document($this->get('/')->assertOk());

        $this->assertSame('All cases · Casefile', $document->title);
        $this->assertNotNull($document->querySelector('.desk.desk-index > .desk-folders.glass'));
        $this->assertNotNull($document->querySelector('.desk.desk-index > .desk-list'));
        $this->assertSame('Choose a case to read it.', trim($document->querySelector('.desk-index > .desk-detail .empty-state-title')->textContent));
        $this->assertSame('page', $document->querySelector('.app-nav a')->getAttribute('aria-current'));
        $this->assertSame('page', $document->querySelector('.folder-link[aria-current]')->getAttribute('aria-current'));
        $this->assertNull($document->querySelector('.back-link'));
    }

    /**
     * @see resources/views/components/case-row.blade.php
     */
    public function test_case_text_is_escaped_in_the_list(): void
    {
        CaseRecord::query()->where('number', 'CASE-0016')->update([
            'subject' => '<script>alert(1)</script>',
            'sender_name' => '<b>Priya</b>',
        ]);

        $response = $this->get('/')->assertOk();

        $response->assertDontSee('<script>alert(1)</script>', false);
        $response->assertDontSee('<b>Priya</b>', false);
        $response->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false);
    }

    /**
     * @see App\Queries\CaseListQuery::paginate()
     */
    public function test_the_list_does_not_query_once_per_row(): void
    {
        $this->createOlderCases(10, []);

        DB::enableQueryLog();
        $this->get('/')->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertLessThanOrEqual(8, $queries);
    }

    /**
     * @param  int  $count
     * @param  array<string, mixed>  $attributes
     * @return void
     */
    private function createOlderCases(int $count, array $attributes): void
    {
        CaseRecord::factory()
            ->count($count)
            ->state(new Sequence(fn (Sequence $sequence): array => [
                'received_at' => CarbonImmutable::now()->subDays(60 + $sequence->index),
            ]))
            ->create($attributes);
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
    private function listedNumbers(HTMLDocument $document): array
    {
        $numbers = [];

        foreach ($document->querySelectorAll('.case-rows a.case-row .case-row-meta .mono') as $node) {
            $numbers[] = trim($node->textContent);
        }

        return $numbers;
    }

    /**
     * @param  HTMLDocument  $document
     * @return array<string, int>
     */
    private function folderCounts(HTMLDocument $document): array
    {
        $counts = [];

        foreach ($document->querySelectorAll('.desk-folders a.folder-link') as $link) {
            $counts[trim($link->querySelector('.folder-name')->textContent)] = (int) trim($link->querySelector('.folder-count')->textContent);
        }

        return $counts;
    }

    /**
     * @param  HTMLDocument  $document
     * @return list<string>
     */
    private function currentFolders(HTMLDocument $document): array
    {
        $names = [];

        foreach ($document->querySelectorAll('.desk-folders a.folder-link[aria-current]') as $link) {
            $names[] = trim($link->querySelector('.folder-name')->textContent);
        }

        return $names;
    }

    /**
     * @param  HTMLDocument  $document
     * @param  string  $number
     * @return Element
     */
    private function row(HTMLDocument $document, string $number): Element
    {
        $row = $document->querySelector('a.case-row[href="'.route('cases.show', ['case' => $number]).'"]');

        $this->assertNotNull($row, $number);

        return $row;
    }
}
