<?php

namespace Tests\Feature;

use App\Data\SearchFilters;
use App\Enums\CaseStatus;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\TrackedSender;
use App\Models\User;
use Dom\HTMLDocument;
use Illuminate\Database\Eloquent\Factories\Sequence;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Pagination\LengthAwarePaginator;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SearchTest extends TestCase
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
    public function test_guest_is_redirected_to_sign_in(): void
    {
        $this->app['auth']->forgetGuards();
        $this->get(route('search', ['q' => 'boiler']))->assertRedirect(route('sign-in'));
    }

    /**
     * @return void
     */
    public function test_seeded_number_prefix_matches_seven_actual_cases_and_empty_state_is_truthful(): void
    {
        $cases = $this->results(['q' => 'CASE-001']);
        $this->assertSame(7, $cases->total());
        $this->assertSame(['CASE-0016', 'CASE-0015', 'CASE-0014', 'CASE-0013', 'CASE-0012', 'CASE-0011', 'CASE-0010'], $cases->pluck('number')->all());
        $this->get(route('search', ['q' => 'no-such-case-needle']))->assertOk()->assertSee('No cases match.')->assertSee('0 cases match.');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function textFields(): array
    {
        return ['number' => ['number'], 'subject' => ['subject'], 'issue' => ['issue'], 'notes' => ['notes']];
    }

    /**
     * @param  string  $field
     * @return void
     */
    #[DataProvider('textFields')]
    public function test_text_matches_each_case_field(string $field): void
    {
        $case = CaseRecord::factory()->create([$field => 'unique-search-marker']);
        $cases = $this->results(['q' => 'unique-search-marker']);
        $this->assertSame([$case->id], $cases->pluck('id')->all());
    }

    /**
     * @return void
     */
    public function test_subject_and_old_message_body_match_without_duplicate_cases(): void
    {
        $subjectCase = CaseRecord::factory()->create(['subject' => 'Boiler diagnostic']);
        $messageCase = CaseRecord::factory()->create(['subject' => 'A conversation']);
        CaseMessage::factory()->for($messageCase, 'case')->create(['body_text' => 'The boiler needs inspection.', 'sent_at' => '2026-10-14 09:00:00']);
        CaseMessage::factory()->for($messageCase, 'case')->create(['body_text' => 'Another boiler update.', 'sent_at' => '2026-10-14 10:00:00']);
        CaseMessage::factory()->for($messageCase, 'case')->create(['body_text' => 'Thanks for responding.', 'sent_at' => '2026-10-15 09:00:00']);
        $matched = $this->results(['q' => 'boiler'])->pluck('id')->all();
        $this->assertContains($subjectCase->id, $matched);
        $this->assertContains($messageCase->id, $matched);
        $this->assertSame(1, count(array_keys($matched, $messageCase->id, true)));
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function literalPatterns(): array
    {
        return [
            'percent' => ['100%', 'It is 100% complete.', 'It is 1000 complete.'],
            'underscore' => ['unit_2B', 'Inspect unit_2B.', 'Inspect unit 2B.'],
            'backslash' => ['folder\\unit', 'Inspect folder\\unit.', 'Inspect folderunit.'],
            'trailing backslash' => ['folder\\', 'Inspect folder\\.', 'Inspect folder.'],
            'combined escapes' => ['path\\100%_done', 'path\\100%_done', 'path1000Xdone'],
            'sql quote' => ["' OR 1=1 --", "Literal ' OR 1=1 -- content", 'Ordinary content'],
        ];
    }

    /**
     * @param  string  $needle
     * @param  string  $literal
     * @param  string  $decoy
     * @return void
     */
    #[DataProvider('literalPatterns')]
    public function test_like_special_characters_are_literal(string $needle, string $literal, string $decoy): void
    {
        $matched = CaseRecord::factory()->create();
        $notMatched = CaseRecord::factory()->create();
        CaseMessage::factory()->for($matched, 'case')->create(['body_text' => $literal]);
        CaseMessage::factory()->for($notMatched, 'case')->create(['body_text' => $decoy]);
        $this->assertSame([$matched->id], $this->results(['q' => $needle])->pluck('id')->all());
    }

    /**
     * @return void
     */
    public function test_statuses_and_sender_filters_match_records(): void
    {
        $cases = $this->results(['status' => ['open', 'closed']]);
        $this->assertSame(14, $cases->total());
        $this->assertNotContains(CaseStatus::InProgress, $cases->pluck('status')->all());
        $sender = TrackedSender::query()->firstOrFail();
        $expected = CaseRecord::query()->where('tracked_sender_id', $sender->id)->orderByDesc('received_at')->orderByDesc('id')->pluck('id')->all();
        $this->assertNotEmpty($expected);
        $this->assertSame($expected, $this->results(['sender' => $sender->id])->pluck('id')->all());
    }

    /**
     * @return void
     */
    public function test_all_filters_constrain_every_text_or_branch(): void
    {
        $sender = TrackedSender::factory()->create();
        $matched = CaseRecord::factory()->create(['subject' => 'combinedneedle', 'status' => CaseStatus::Open, 'tracked_sender_id' => $sender->id, 'received_at' => '2026-10-15 12:00:00']);
        CaseRecord::factory()->create(['subject' => 'combinedneedle', 'status' => CaseStatus::Open, 'received_at' => '2026-10-15 12:00:00']);
        $wrongStatus = CaseRecord::factory()->create(['status' => CaseStatus::InProgress, 'tracked_sender_id' => $sender->id, 'received_at' => '2026-10-15 12:00:00']);
        CaseMessage::factory()->for($wrongStatus, 'case')->create(['body_text' => 'combinedneedle']);
        CaseRecord::factory()->create(['notes' => 'combinedneedle', 'status' => CaseStatus::Open, 'tracked_sender_id' => $sender->id, 'received_at' => '2026-10-16 00:00:00']);
        CaseRecord::factory()->create(['issue' => 'combinedneedle', 'status' => CaseStatus::Open, 'tracked_sender_id' => $sender->id, 'received_at' => '2026-10-14 23:59:59']);
        $this->assertSame([$matched->id], $this->results(['q' => 'combinedneedle', 'status' => ['open', 'closed'], 'sender' => $sender->id, 'from' => '2026-10-15', 'to' => '2026-10-15'])->pluck('id')->all());
    }

    /**
     * @return void
     */
    public function test_dates_include_whole_boundary_days_and_accept_a_to_only_range(): void
    {
        $before = CaseRecord::factory()->create(['notes' => 'dateboundary', 'received_at' => '2026-10-14 23:59:59']);
        $first = CaseRecord::factory()->create(['notes' => 'dateboundary', 'received_at' => '2026-10-15 00:00:00']);
        $last = CaseRecord::factory()->create(['notes' => 'dateboundary', 'received_at' => '2026-10-15 23:59:59']);
        $after = CaseRecord::factory()->create(['notes' => 'dateboundary', 'received_at' => '2026-10-16 00:00:00']);
        $this->assertSame([$last->id, $first->id], $this->results(['q' => 'dateboundary', 'from' => '2026-10-15', 'to' => '2026-10-15'])->pluck('id')->all());
        $this->assertSame([$last->id, $first->id, $before->id], $this->results(['q' => 'dateboundary', 'to' => '2026-10-15'])->pluck('id')->all());
        $this->assertSame([$after->id, $last->id, $first->id], $this->results(['q' => 'dateboundary', 'from' => '2026-10-15'])->pluck('id')->all());
    }

    /**
     * @return void
     */
    public function test_end_date_includes_fractional_final_second_and_maximum_four_digit_year(): void
    {
        $case = CaseRecord::factory()->create(['notes' => 'fractionaldate', 'received_at' => '2026-10-15 23:59:59']);
        CaseRecord::query()->whereKey($case)->update(['received_at' => '2026-10-15 23:59:59.999999']);
        $this->assertSame([$case->id], $this->results(['q' => 'fractionaldate', 'to' => '2026-10-15'])->pluck('id')->all());
        $this->assertSame([$case->id], $this->results(['q' => 'fractionaldate', 'to' => '9999-12-31'])->pluck('id')->all());
    }

    /**
     * @return array<string, array{array<string, mixed>, string}>
     */
    public static function invalidFilters(): array
    {
        return [
            'long text' => [['q' => str_repeat('x', 201)], 'q'],
            'array text' => [['q' => ['bad']], 'q'],
            'scalar status' => [['status' => 'open'], 'status'],
            'nested status' => [['status' => [['open']]], 'status.0'],
            'unknown status' => [['status' => ['archived']], 'status.0'],
            'array sender' => [['sender' => ['1']], 'sender'],
            'decimal sender' => [['sender' => '1.5'], 'sender'],
            'missing sender' => [['sender' => '999999'], 'sender'],
            'array from' => [['from' => ['bad'], 'to' => '2026-10-15'], 'from'],
            'array to' => [['to' => ['bad']], 'to'],
            'invalid day' => [['from' => '2026-02-30'], 'from'],
            'reverse range' => [['from' => '2026-10-16', 'to' => '2026-10-15'], 'to'],
            'array page' => [['page' => ['2']], 'page'],
            'zero page' => [['page' => '0'], 'page'],
        ];
    }

    /**
     * @param  array<string, mixed>  $input
     * @param  string  $error
     * @return void
     */
    #[DataProvider('invalidFilters')]
    public function test_invalid_get_redirects_to_clean_url_and_renders_errors_safely(array $input, string $error): void
    {
        $this->from(route('search', $input))->get(route('search', $input))
            ->assertRedirect(route('search'))->assertSessionHasErrors($error);
        $response = $this->get(route('search'))->assertOk()->assertSee('field-error', false);
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertNotNull($document->querySelector('[aria-invalid="true"]') ?? $document->querySelector('.field-error'));
    }

    /**
     * @return array<string, array{array<string, string>, string}>
     */
    public static function malformedDateRanges(): array
    {
        return [
            'embedded NUL start' => [['from' => "2026-10-\0".'15', 'to' => '2026-10-16'], 'from'],
            'embedded NUL end' => [['from' => '2026-10-15', 'to' => "2026-10-\0".'16'], 'to'],
            'unparseable start' => [['from' => 'not-a-date', 'to' => '2026-10-16'], 'from'],
            'invalid calendar start' => [['from' => '2026-02-30', 'to' => '2026-10-16'], 'from'],
            'wrong start format' => [['from' => '15-10-2026', 'to' => '2026-10-16'], 'from'],
        ];
    }

    /**
     * @param  array<string, string>  $input
     * @param  string  $error
     * @return void
     */
    #[DataProvider('malformedDateRanges')]
    public function test_malformed_dates_render_errors_and_case_return_context_falls_back(array $input, string $error): void
    {
        $otherDate = $error === 'from' ? 'to' : 'from';
        $this->get(route('search', $input))->assertRedirect(route('search'))
            ->assertSessionHasErrors($error)->assertSessionDoesntHaveErrors($otherDate)
            ->assertSessionHasInput($error, $input[$error]);
        $this->get(route('search'))->assertOk()->assertSee('id="'.$error.'-error"', false);

        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $this->get(route('cases.show', ['case' => $case->number, 'search' => $input]))
            ->assertOk()->assertViewHas('searchReturnUrl', null)->assertSee('Back to cases')->assertDontSee('Back to search');
    }

    /**
     * @return void
     */
    public function test_json_validation_uses_422_and_maximum_text_and_escaped_old_input_render(): void
    {
        $this->getJson(route('search', ['q' => ['bad'], 'status' => 'open']))->assertUnprocessable()->assertJsonValidationErrors(['q', 'status']);
        $this->get(route('search', ['q' => str_repeat('x', 200)]))->assertOk();
        $markup = '<script>alert(1)</script>';
        $this->get(route('search', ['q' => $markup, 'status' => 'bad']))->assertSessionHasErrors('status')->assertSessionHasInput('q', $markup);
        $this->get(route('search'))->assertOk()->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee($markup, false);
    }

    /**
     * @return void
     */
    public function test_pagination_is_stable_keeps_only_validated_filters_and_loads_row_relations(): void
    {
        $sender = TrackedSender::factory()->create();
        $records = CaseRecord::factory()->count(30)->sequence(fn (Sequence $sequence): array => ['received_at' => $sequence->index < 15 ? '2026-10-15 12:00:00' : '2026-10-15 13:00:00'])
            ->create(['subject' => 'paginationneedle', 'status' => CaseStatus::Open, 'tracked_sender_id' => $sender->id]);
        $parameters = ['q' => 'paginationneedle', 'status' => ['open'], 'sender' => $sender->id, 'from' => '2026-10-15', 'to' => '2026-10-15'];
        $first = $this->results([...$parameters, 'unknown' => 'discard-me']);
        $second = $this->results([...$parameters, 'page' => 2]);
        $expected = $records->pluck('id')->reverse()->values()->all();
        $this->assertSame(30, $first->total());
        $this->assertSame(25, $first->count());
        $this->assertSame(array_slice($expected, 0, 25), $first->pluck('id')->all());
        $this->assertSame(array_slice($expected, 25), $second->pluck('id')->all());
        parse_str(parse_url($first->nextPageUrl(), PHP_URL_QUERY), $next);
        $this->assertEquals([...$parameters, 'sender' => (string) $sender->id, 'page' => '2'], $next);
        foreach ($first as $case) {
            $this->assertTrue($case->relationLoaded('latestMessage'));
            $this->assertArrayHasKey('attachments_count', $case->getAttributes());
        }
        $this->get(route('search', [...$parameters, 'page' => 2]))->assertSee('30 cases match.')->assertSee('Page 2 of 2');
        $this->get(route('search', [...$parameters, 'page' => 3]))->assertSee('No cases on this page.')->assertSee('First page');
    }

    /**
     * @return void
     */
    public function test_search_return_link_preserves_filters_and_page_and_drops_invalid_context(): void
    {
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $parameters = ['q' => 'CASE-001', 'status' => ['open', 'closed'], 'sender' => $case->tracked_sender_id, 'from' => '2020-01-01', 'to' => '2030-01-01', 'page' => 2];
        $response = $this->get(route('search', $parameters))->assertOk();
        $this->assertEquals(['search' => $parameters], $response->viewData('listQuery'));
        $caseResponse = $this->get(route('cases.show', ['case' => $case->number, 'search' => [...$parameters, 'url' => 'https://outside.example']]))
            ->assertOk()->assertSee('Back to search');
        $document = HTMLDocument::createFromString($caseResponse->getContent(), LIBXML_NOERROR);
        $returnLink = $document->querySelector('.back-link')->getAttribute('href');
        $this->assertSame($caseResponse->viewData('searchReturnUrl'), $returnLink);
        foreach ([PHP_URL_SCHEME, PHP_URL_HOST, PHP_URL_PORT, PHP_URL_PATH] as $part) {
            $this->assertSame(parse_url(route('search'), $part), parse_url($returnLink, $part));
        }
        $this->assertStringNotContainsString('outside.example', $returnLink);
        parse_str(parse_url($returnLink, PHP_URL_QUERY), $returned);
        $this->assertEquals($parameters, $returned);
        $this->assertArrayNotHasKey('url', $returned);
        foreach (['bad', ['q' => ['bad']], ['status' => 'open'], ['sender' => '999999'], ['page' => ['2']]] as $invalid) {
            $this->get(route('cases.show', ['case' => $case->number, 'search' => $invalid]))->assertOk()->assertViewHas('searchReturnUrl', null)->assertSee('Back to cases')->assertDontSee('Back to search');
        }
        $this->get(route('search', ['q' => 'CASE-001']))->assertSee('search%5Bq%5D=CASE-001', false);
    }

    /**
     * @return void
     */
    public function test_shared_chrome_and_form_have_single_case_link_labels_pending_and_active_search(): void
    {
        foreach ([route('home'), route('search'), route('notifications')] as $url) {
            $document = HTMLDocument::createFromString($this->get($url)->assertOk()->getContent(), LIBXML_NOERROR);
            $nav = $document->querySelector('nav[aria-label="Main"]');
            foreach ([route('home') => 'Cases', route('search') => 'Search', route('settings') => 'Settings'] as $href => $label) {
                $links = $nav->querySelectorAll('a[href="'.$href.'"]');
                $this->assertSame(1, $links->length);
                $this->assertSame($label, trim($links->item(0)->textContent));
                $this->assertTrue($links->item(0)->hasAttribute('data-pending'));
            }
        }
        $document = HTMLDocument::createFromString($this->get(route('search'))->getContent(), LIBXML_NOERROR);
        $this->assertSame('Search', trim($document->querySelector('nav[aria-label="Main"] [aria-current="page"]')->textContent));
        $form = $document->querySelector('form.search-box');
        $this->assertTrue($form->hasAttribute('data-pending'));
        $this->assertSame(3, $form->querySelectorAll('input[type="checkbox"]')->length);
        $this->assertSame(2, $form->querySelectorAll('input[type="date"]')->length);
        foreach ($form->querySelectorAll('input, select') as $field) {
            $this->assertNotNull($form->querySelector('label[for="'.$field->id.'"]'));
        }
        $this->assertSame('Search', trim($form->querySelector('.form-actions')->lastElementChild->textContent));
    }

    /**
     * @param  array<string, mixed>  $parameters
     * @return LengthAwarePaginator<int, CaseRecord>
     */
    private function results(array $parameters): LengthAwarePaginator
    {
        $response = $this->get(route('search', $parameters))->assertOk();
        $this->assertInstanceOf(SearchFilters::class, $response->viewData('filters'));

        return $response->viewData('cases');
    }
}
