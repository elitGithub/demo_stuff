<?php

namespace Tests\Feature;

use App\Enums\CaseStatus;
use App\Enums\MessageDirection;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\User;
use App\Queries\BoardQuery;
use Carbon\CarbonImmutable;
use Dom\HTMLDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\URL;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class LayoutRenderTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->actingAs(User::query()->findOrFail(1));
    }

    /**
     * @return void
     */
    public function test_mail_list_unread_markers_match_latest_message_including_equal_time_ties(): void
    {
        $this->withCookie(config('casefile.layout.cookie'), 'mail');
        $response = $this->get('/')->assertOk()->assertViewIs('workspace.mail.index');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertCount(16, $document->querySelectorAll('.mail-case-row'));
        $this->assertCount(8, $document->querySelectorAll('.mail-unread'));
        foreach ($response->viewData('list')->cases as $case) {
            $row = $document->querySelector('.mail-case-row[href="'.route('cases.show', $case).'"]');
            $this->assertSame($case->latestMessage->direction === MessageDirection::Inbound, $row->querySelector('.mail-unread') !== null);
        }
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $time = CarbonImmutable::now()->addDay();
        CaseMessage::factory()->create(['case_id' => $case->id, 'sent_at' => $time, 'direction' => MessageDirection::Inbound]);
        CaseMessage::factory()->create(['case_id' => $case->id, 'sent_at' => $time, 'direction' => MessageDirection::Outbound, 'body_text' => '<script>Latest outbound</script>']);
        CaseMessage::factory()->create(['case_id' => $case->id, 'sent_at' => $time->subDay(), 'direction' => MessageDirection::Inbound]);
        $response = $this->get('/')->assertOk()->assertSee('<script>Latest outbound</script>')->assertDontSee('<script>Latest outbound</script>', false);
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $row = $document->querySelector('.mail-case-row[href="'.route('cases.show', $case).'"]');
        $this->assertNull($row->querySelector('.mail-unread'));
        CaseMessage::factory()->create(['case_id' => $case->id, 'sent_at' => $time, 'direction' => MessageDirection::Inbound]);
        $document = HTMLDocument::createFromString($this->get('/')->assertOk()->getContent(), LIBXML_NOERROR);
        $this->assertNotNull($document->querySelector('.mail-case-row[href="'.route('cases.show', $case).'"] .mail-unread'));
    }

    /**
     * @return void
     */
    public function test_mail_reading_pane_has_shared_draft_safe_forms_focus_controls_facts_and_search_return(): void
    {
        $response = $this->withCookie(config('casefile.layout.cookie'), 'mail')->withSession(['auto_reply_case' => 'CASE-0016'])
            ->get('/cases/CASE-0016?search[q]=water')->assertOk()->assertViewIs('workspace.mail.show')
            ->assertSee('Back to search')->assertSee(route('search', ['q' => 'water']))->assertSee('Tracked')->assertSee('data-auto-reply-show', false);
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertStringContainsString('CASE-0016', $document->querySelector('.mail-facts')->textContent);
        $this->assertCount(4, $document->querySelectorAll('[data-draft-form] [data-original-value]'));
        $this->assertNotNull($document->querySelector('[data-focus-reply][href="#reply-body"]'));
        $this->assertNotNull($document->querySelector('[data-details-open][data-details-focus="case-notes"]'));
        $this->assertNotNull($document->querySelector('[data-details-sheet] #case-notes'));
        foreach ($document->querySelectorAll('.floating-toolbar form, [data-draft-form]') as $form) {
            $this->assertTrue($form->hasAttribute('data-pending'));
            $this->assertNotNull($form->querySelector('input[name="_token"]'));
        }
        $response->assertDontSee(' style="', false);
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $this->patch(route('cases.status', $case), ['status' => 'closed'])->assertRedirect(route('cases.show', $case).'#case-heading');
        $this->get(route('cases.show', $case))->assertOk()->assertSee('Reopen case');
        $this->withCookie(config('casefile.layout.cookie'), 'board')->get('/cases/CASE-0016?search[q]=water')->assertOk()
            ->assertViewIs('workspace.board.show')->assertSee('Back to search')->assertSee('Send via Gmail');
    }

    /**
     * @return void
     */
    public function test_mail_paginates_and_retains_filter_context_in_case_links(): void
    {
        CaseRecord::factory()->count(30)->create(['status' => CaseStatus::Open]);
        $this->withCookie(config('casefile.layout.cookie'), 'mail');
        $first = $this->get('/?status=open')->assertOk();
        $this->assertCount(25, $first->viewData('list')->cases);
        $response = $this->get('/?status=open&page=2')->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertCount($response->viewData('list')->cases->count(), $document->querySelectorAll('.mail-case-row'));
        foreach ($document->querySelectorAll('.mail-case-row') as $row) {
            parse_str(parse_url($row->getAttribute('href'), PHP_URL_QUERY), $query);
            $this->assertSame(['status' => 'open', 'page' => '2'], $query);
        }
        $this->get('/?status=open&page=500')->assertOk()->assertSee('No cases on this page.')->assertSee('Go to the first page');
    }

    /**
     * @return void
     */
    public function test_mail_rendered_filters_navigate_each_status_and_clear_a_later_page(): void
    {
        CaseRecord::factory()->count(30)->create(['status' => CaseStatus::Open]);
        $this->withCookie(config('casefile.layout.cookie'), 'mail');
        $response = $this->get('/?status=open&page=2')->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $links = $document->querySelectorAll('.mail-filters a');
        $this->assertCount(4, $links);
        $this->assertCount(1, $document->querySelectorAll('.mail-filters [aria-current]'));

        foreach ([null, ...CaseStatus::cases()] as $index => $status) {
            $link = $links[$index];
            $url = $link->getAttribute('href');
            $expectedUrl = route('home', $status === null ? [] : ['status' => $status->value]);
            $expected = CaseRecord::query()->when($status !== null, fn ($query) => $query->where('status', $status))->orderByDesc('received_at')->orderByDesc('id');
            $total = $expected->count();
            $this->assertSame($expectedUrl, $url);
            $this->assertTrue($link->hasAttribute('data-pending'));
            $this->assertSame((string) $total, $link->querySelector('span')->textContent);
            $this->assertStringContainsString($status?->label() ?? 'All', $link->textContent);

            $filtered = $this->get($url)->assertOk();
            $this->assertSame(1, $filtered->viewData('list')->cases->currentPage());
            $this->assertSame($status, $filtered->viewData('list')->status);
            $this->assertSame($total, $filtered->viewData('list')->cases->total());
            $this->assertSame($expected->take(25)->pluck('number')->all(), $filtered->viewData('list')->cases->pluck('number')->all());
            $filteredDocument = HTMLDocument::createFromString($filtered->getContent(), LIBXML_NOERROR);
            $active = $filteredDocument->querySelectorAll('.mail-filters [aria-current]');
            $this->assertCount(1, $active);
            $this->assertSame($url, $active[0]->getAttribute('href'));
            $this->assertSame('page', $active[0]->getAttribute('aria-current'));

            $caseLink = $filteredDocument->querySelector('.mail-case-row')->getAttribute('href');
            $reading = HTMLDocument::createFromString($this->get($caseLink)->assertOk()->getContent(), LIBXML_NOERROR);
            $readingActive = $reading->querySelectorAll('.mail-filters [aria-current]');
            $this->assertCount(1, $readingActive);
            $this->assertSame($url, $readingActive[0]->getAttribute('href'));
            $this->assertSame('true', $readingActive[0]->getAttribute('aria-current'));
        }
    }

    /**
     * @return void
     */
    public function test_board_places_every_seeded_case_under_its_status_and_counts_exactly(): void
    {
        $response = $this->withCookie(config('casefile.layout.cookie'), 'board')->get('/')->assertOk()->assertViewIs('workspace.board.index');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        foreach (CaseStatus::cases() as $status) {
            $column = $document->querySelector('[data-board-status="'.$status->value.'"]');
            $expected = CaseRecord::query()->where('status', $status)->orderByDesc('received_at')->orderByDesc('id')->pluck('number')->all();
            $this->assertSame((string) count($expected), $column->querySelector('.board-count')->textContent);
            $actual = [];
            foreach ($column->querySelectorAll('.board-card') as $card) {
                $actual[] = substr($card->id, strlen('board-card-'));
                $form = $card->querySelector('form');
                $this->assertTrue($form->hasAttribute('data-pending'));
                $this->assertNotNull($form->querySelector('input[name="_token"]'));
                $this->assertSame($status->value, $form->querySelector('option[selected]')->getAttribute('value'));
            }
            $this->assertSame($expected, $actual);
        }
        $this->assertNotNull($document->querySelector('.board-card-meta .icon'));
        $response->assertDontSee(' style="', false);
    }

    /**
     * @return void
     */
    public function test_columns_paginate_independently_and_preserve_other_pages_and_counts(): void
    {
        foreach (CaseStatus::cases() as $status) {
            CaseRecord::factory()->count(21)->create(['status' => $status]);
        }
        $response = $this->withCookie(config('casefile.layout.cookie'), 'board')->get('/?open_page=2&closed_page=3&in_progress_page=1')->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        foreach ($response->viewData('board')->columns as $column) {
            $expectedPage = match ($column->status) {
                CaseStatus::Open => 2, CaseStatus::Closed => 3, default => 1
            };
            $this->assertSame($expectedPage, $column->cases->currentPage());
            $expected = CaseRecord::query()->where('status', $column->status)->orderByDesc('received_at')->orderByDesc('id')
                ->skip(($expectedPage - 1) * BoardQuery::PER_PAGE)->take(BoardQuery::PER_PAGE)->pluck('number')->all();
            $this->assertSame($expected, $column->cases->pluck('number')->all());
            $section = $document->querySelector('[data-board-status="'.$column->status->value.'"]');
            $this->assertSame((string) $column->cases->total(), $section->querySelector('.board-count')->textContent);
            $this->assertLessThanOrEqual(10, $section->querySelectorAll('.board-card')->length);
            foreach ($section->querySelectorAll('.pagination a') as $link) {
                $this->assertSame('board-'.$column->status->value, parse_url($link->getAttribute('href'), PHP_URL_FRAGMENT));
                parse_str(parse_url($link->getAttribute('href'), PHP_URL_QUERY), $query);
                foreach (CaseStatus::cases() as $other) {
                    if ($other !== $column->status) {
                        $this->assertSame((string) $response->viewData('board')->query[$other->value.'_page'], $query[$other->value.'_page']);
                    }
                }
            }
        }
    }

    /**
     * @return void
     */
    public function test_every_board_column_previous_and_next_link_restores_its_column_and_query_state(): void
    {
        foreach (CaseStatus::cases() as $status) {
            CaseRecord::factory()->count(21)->create(['status' => $status]);
        }
        $response = $this->withCookie(config('casefile.layout.cookie'), 'board')->get('/?open_page=2&in_progress_page=2&closed_page=2')->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);

        foreach (CaseStatus::cases() as $status) {
            $section = $document->querySelector('[data-board-status="'.$status->value.'"]');
            foreach (['prev' => 1, 'next' => 3] as $relation => $page) {
                $link = $section->querySelector('.pagination a[rel="'.$relation.'"]');
                $this->assertNotNull($link);
                $url = $link->getAttribute('href');
                $this->assertSame('board-'.$status->value, parse_url($url, PHP_URL_FRAGMENT));
                parse_str(parse_url($url, PHP_URL_QUERY), $query);
                $this->assertCount(3, $query);
                foreach (CaseStatus::cases() as $columnStatus) {
                    $this->assertSame((string) ($columnStatus === $status ? $page : 2), $query[$columnStatus->value.'_page']);
                }
                $destination = $this->get($url)->assertOk();
                $this->assertSame($page, $destination->viewData('board')->query[$status->value.'_page']);
            }
        }
    }

    /**
     * @return void
     */
    public function test_move_to_a_paginated_destination_obeys_received_time_id_ties_and_clamps_empty_source_page(): void
    {
        $this->withCookie(config('casefile.layout.cookie'), 'board');
        $time = CarbonImmutable::parse('2020-01-01 12:00:00');
        $source = CaseRecord::factory()->create(['status' => CaseStatus::Open, 'received_at' => $time]);
        $sourceCount = CaseRecord::query()->where('status', CaseStatus::Open)->count();
        CaseRecord::factory()->count(21 - $sourceCount)->create(['status' => CaseStatus::Open, 'received_at' => $time->addDay()]);
        $ahead = CaseRecord::query()->where('status', CaseStatus::Closed)->count();
        CaseRecord::factory()->count(20 - $ahead)->create(['status' => CaseStatus::Closed, 'received_at' => $time]);
        $this->assertSame(3, BoardQuery::pageFor($source));
        $beforeEvents = $source->events()->count();
        $response = $this->patch(route('cases.status', $source), ['status' => 'closed', 'return_to' => 'board', 'board' => ['open_page' => 3, 'closed_page' => 1, 'in_progress_page' => 1]])
            ->assertRedirect(route('home', ['open_page' => 3, 'closed_page' => 3, 'in_progress_page' => 1]).'#board-card-'.$source->number);
        $this->assertSame(CaseStatus::Closed, $source->fresh()->status);
        $this->assertSame($beforeEvents + 1, $source->events()->count());
        $this->assertSame('closed', $source->events()->latest('id')->first()->to_status->value);
        $destination = $this->get($response->headers->get('Location'))->assertOk();
        $document = HTMLDocument::createFromString($destination->getContent(), LIBXML_NOERROR);
        $this->assertNotNull($document->querySelector('#board-closed #board-card-'.$source->number));
        $this->assertCount(10, $document->querySelectorAll('#board-open .board-card'));
        $this->assertSame(2, $destination->viewData('board')->query['open_page']);
        $this->assertSame(21, CaseRecord::query()->where('status', CaseStatus::Closed)->count());
    }

    /**
     * @return array<string, array{array}>
     */
    public static function invalidContexts(): array
    {
        return [
            'external route' => [['return_to' => 'https://outside.example']],
            'array return' => [['return_to' => ['board']]],
            'scalar board' => [['return_to' => 'board', 'board' => 'bad']],
            'nested page' => [['return_to' => 'board', 'board' => ['open_page' => [2]]]],
            'zero' => [['return_to' => 'board', 'board' => ['open_page' => 0]]],
            'negative' => [['return_to' => 'board', 'board' => ['closed_page' => -1]]],
            'fraction' => [['return_to' => 'board', 'board' => ['closed_page' => 1.5]]],
            'unknown key' => [['return_to' => 'board', 'board' => ['url' => 'https://outside.example']]],
            'huge page' => [['return_to' => 'board', 'board' => ['open_page' => '999999999999999999999']]],
        ];
    }

    /**
     * @param  array  $context
     * @return void
     */
    #[DataProvider('invalidContexts')]
    public function test_bad_board_context_cannot_mutate_or_redirect_outside(array $context): void
    {
        $this->withCookie(config('casefile.layout.cookie'), 'board');
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $this->from(route('home'))->patch(route('cases.status', $case), ['status' => 'closed', ...$context])->assertRedirect(route('home'))->assertSessionHasErrors();
        $this->assertSame(CaseStatus::Open, $case->fresh()->status);
        $this->get('/')->assertOk();
    }

    /**
     * @return void
     */
    public function test_wrong_shaped_get_pages_render_safely_and_new_board_return_uses_a_fixed_route(): void
    {
        $this->withCookie(config('casefile.layout.cookie'), 'board');
        foreach (['open_page[]=2', 'open_page[x][]=2', 'closed_page=-4', 'in_progress_page=1.5', 'open_page=999999999999999999999', 'open_page=90000'] as $query) {
            $response = $this->get('/?'.$query)->assertOk();
            foreach ($response->viewData('board')->columns as $column) {
                $this->assertSame(1, $column->cases->currentPage());
            }
        }
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $this->patch(route('cases.status', $case), ['status' => 'closed', 'return_to' => 'board', 'url' => 'https://outside.example'])
            ->assertRedirect(route('home', ['closed_page' => 1]).'#board-card-'.$case->number);
    }

    /**
     * @return void
     */
    public function test_board_return_keeps_the_deployment_prefix_and_exact_location_header(): void
    {
        config(['app.url' => 'https://demo.example/casefile']);
        URL::forceRootUrl(config('app.url'));
        URL::forceScheme('https');
        $this->withServerVariables([
            'SCRIPT_NAME' => '/casefile/index.php',
            'SCRIPT_FILENAME' => '/var/www/demo_stuff/case-management-system/public/index.php',
            'PHP_SELF' => '/casefile/index.php',
        ])->withCookie(config('casefile.layout.cookie'), 'board');
        $response = $this->patch('https://demo.example/casefile/cases/CASE-0016/status', ['status' => 'closed', 'return_to' => 'board']);
        $this->assertSame('https://demo.example/casefile?closed_page=1#board-card-CASE-0016', $response->headers->get('Location'));
        $this->get('https://demo.example/casefile/?closed_page=1#board-card-CASE-0016')->assertOk()->assertSee('id="board-card-CASE-0016"', false);
    }
}
