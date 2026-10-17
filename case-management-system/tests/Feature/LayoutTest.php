<?php

namespace Tests\Feature;

use App\Enums\CaseStatus;
use App\Enums\WorkspaceLayout;
use App\Layouts\LayoutResolver;
use App\Models\CaseRecord;
use Carbon\CarbonImmutable;
use Dom\HTMLDocument;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\URL;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\BuildsTemplateFile;
use Tests\TestCase;

class LayoutTest extends TestCase
{
    use BuildsTemplateFile;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->buildTemplate();
        config(['casefile.mode' => 'demo']);
        $this->post('/sign-in/google')->assertRedirect(route('home'));
        $this->withCookie(config('session.cookie'), session()->getId())->withCredentials();
        Auth::forgetGuards();
    }

    /**
     * @return void
     */
    public function test_a_genuinely_cookieless_home_opens_the_picker(): void
    {
        $this->get('/')->assertRedirect(route('layout.picker'))->assertSessionHas('layout.intended', route('home'));
        $response = $this->get('/layout')->assertOk()->assertSee('Choose how you like to work.')
            ->assertSee('On a phone every layout shows one pane at a time.');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertCount(4, $document->querySelectorAll('.layout-choice'));
        $this->assertCount(4, $document->querySelectorAll('.layout-thumbnail'));
        foreach ($document->querySelectorAll('.layout-choice') as $form) {
            $this->assertTrue($form->hasAttribute('data-pending'));
            $this->assertNotNull($form->querySelector('input[name="_token"]'));
            $this->assertSame(route('home'), $form->querySelector('input[name="intended"]')->getAttribute('value'));
        }
    }

    /**
     * @return void
     */
    public function test_cookieless_case_entry_preserves_nested_search_and_status_query(): void
    {
        $target = route('cases.show', ['case' => 'CASE-0016', 'page' => 2, 'search' => ['q' => 'water', 'status' => ['open']], 'status' => 'open']);
        $this->get($target)->assertRedirect(route('layout.picker'))->assertSessionHas('layout.intended', $target);
        $this->post(route('layout.choose'), ['layout' => 'tracker'])->assertRedirect($target)->assertSessionMissing('layout.intended');
        $this->withCookie(config('casefile.layout.cookie'), 'tracker')->get($target)->assertOk()->assertViewIs('workspace.tracker.show')
            ->assertSee('Back to search')->assertSee(route('search', ['q' => 'water', 'status' => ['open']]));
    }

    /**
     * @return void
     */
    public function test_tracker_choice_sets_a_year_cookie_and_redirects_home(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-17 12:00:00', 'UTC'));
        $response = $this->post('/layout', ['layout' => 'tracker'])->assertRedirect(route('home'))
            ->assertCookie(config('casefile.layout.cookie'), 'tracker');
        $cookie = $response->getCookie(config('casefile.layout.cookie'));
        $this->assertSame('/', $cookie->getPath());
        $this->assertSame(now()->addDays(365)->getTimestamp(), $cookie->getExpiresTime());
        $this->assertTrue($cookie->isHttpOnly());
        $this->assertSame('lax', $cookie->getSameSite());
    }

    /**
     * @return array<string, array{string}>
     */
    public static function invalidCookies(): array
    {
        return ['unknown' => ['sideways'], 'empty' => [''], 'case sensitive' => ['TRACKER'], 'markup' => ['<script>alert(1)</script>']];
    }

    /**
     * @param  string  $value
     * @return void
     */
    #[DataProvider('invalidCookies')]
    public function test_present_invalid_cookies_render_desk_without_redirect(string $value): void
    {
        $response = $this->withCookie(config('casefile.layout.cookie'), $value)->get('/')->assertOk()->assertViewIs('workspace.desk.index')
            ->assertViewHas('layout', WorkspaceLayout::Desk)->assertSee('CASE-0016');
        if ($value !== '') {
            $response->assertDontSee($value, false);
        }
        $this->get('/cases/CASE-0016')->assertOk()->assertViewIs('workspace.desk.show');
    }

    /**
     * @return void
     */
    public function test_tampered_unencrypted_cookie_is_present_and_falls_back_to_desk(): void
    {
        $this->withUnencryptedCookie(config('casefile.layout.cookie'), 'sideways')->get('/')->assertOk()->assertViewIs('workspace.desk.index');
    }

    /**
     * @return void
     */
    public function test_resolver_distinguishes_missing_null_and_array_cookies_without_crashing(): void
    {
        $layouts = app(LayoutResolver::class);
        $this->assertNull($layouts->fromRequest(Request::create('/')));
        foreach ([null, ['tracker'], 'sideways', ''] as $value) {
            $request = Request::create('/');
            $request->cookies->set(config('casefile.layout.cookie'), $value);
            $this->assertSame(WorkspaceLayout::Desk, $layouts->fromRequest($request));
        }
        foreach (WorkspaceLayout::cases() as $layout) {
            $request = Request::create('/');
            $request->cookies->set(config('casefile.layout.cookie'), $layout->value);
            $this->assertSame($layout, $layouts->fromRequest($request));
        }
    }

    /**
     * @return array<string, array{mixed}>
     */
    public static function invalidChoices(): array
    {
        return ['unknown' => ['sideways'], 'missing' => [null], 'array' => [['tracker']], 'empty' => [''], 'upper case' => ['TRACKER']];
    }

    /**
     * @param  mixed  $choice
     * @return void
     */
    #[DataProvider('invalidChoices')]
    public function test_invalid_choices_have_field_errors_and_never_issue_a_cookie(mixed $choice): void
    {
        $response = $this->from(route('layout.picker'))->post('/layout', ['layout' => $choice])
            ->assertRedirect(route('layout.picker'))->assertSessionHasErrors('layout')->assertCookieMissing(config('casefile.layout.cookie'));
        $this->get($response->headers->get('Location'))->assertOk();
    }

    /**
     * @return void
     */
    public function test_tracker_counts_rows_order_and_filters_match_the_records(): void
    {
        $this->withCookie(config('casefile.layout.cookie'), 'tracker');
        $response = $this->get('/')->assertOk()->assertViewIs('workspace.tracker.index');
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $expected = CaseRecord::query()->orderByDesc('received_at')->orderByDesc('id')->pluck('number')->all();
        $numbers = [];
        foreach ($document->querySelectorAll('.tracker-number') as $number) {
            $numbers[] = $number->textContent;
        }
        $this->assertSame($expected, $numbers);
        $this->assertSame('CASE-0016', $numbers[0]);
        foreach ([null, ...CaseStatus::cases()] as $status) {
            $url = route('home', $status === null ? [] : ['status' => $status->value]);
            $link = $document->querySelector('.tracker-sidebar a[href="'.$url.'"]');
            $count = CaseRecord::query()->when($status !== null, fn ($query) => $query->where('status', $status))->count();
            $this->assertSame((string) $count, trim($link->querySelector('.folder-count')->textContent));
            $filtered = $this->get($url)->assertOk();
            $this->assertCount($count, $filtered->viewData('list')->cases);
            foreach ($filtered->viewData('list')->cases as $case) {
                if ($status !== null) {
                    $this->assertSame($status, $case->status);
                }
            }
        }
        $this->assertNotNull($document->querySelector('.tracker-row .tracker-attachment .icon'));
    }

    /**
     * @return void
     */
    public function test_tracker_paginates_and_keeps_filters_on_rows_and_next_page(): void
    {
        CaseRecord::factory()->count(30)->create(['status' => CaseStatus::Open]);
        $this->withCookie(config('casefile.layout.cookie'), 'tracker');
        $response = $this->get('/?status=open')->assertOk()->assertSee('status=open&amp;page=2', false);
        $this->assertCount(25, $response->viewData('list')->cases);
        $second = $this->get('/?status=open&page=2')->assertOk();
        $document = HTMLDocument::createFromString($second->getContent(), LIBXML_NOERROR);
        $this->assertStringContainsString('status=open', $document->querySelector('.tracker-row')->getAttribute('href'));
        $this->assertStringContainsString('page=2', $document->querySelector('.tracker-row')->getAttribute('href'));
        $this->assertSame($response->viewData('list')->cases->total() - 25, $second->viewData('list')->cases->count());
        $this->get('/?status=open&page=100')->assertOk()->assertSee('This page is past the end of the list.');
    }

    /**
     * @return void
     */
    public function test_tracker_case_reuses_the_thread_forms_and_draft_safe_auto_reply_controls(): void
    {
        $response = $this->withCookie(config('casefile.layout.cookie'), 'tracker')->withSession(['auto_reply_case' => 'CASE-0016'])
            ->get('/cases/CASE-0016?status=open&page=2')->assertOk()->assertViewIs('workspace.tracker.show')
            ->assertSee('CASE-0016')->assertSee('Conversation')->assertSee('Manage case')->assertSee('Send via Gmail')->assertSee('data-auto-reply-show', false)
            ->assertSee(route('home', ['status' => 'open', 'page' => 2]));
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        foreach (['case-details', 'reply-composer'] as $identifier) {
            $form = $document->querySelector('#'.$identifier);
            $this->assertTrue($form->hasAttribute('data-draft-form'));
            $this->assertTrue($form->hasAttribute('data-pending'));
            $this->assertNotNull($form->querySelector('input[name="_token"]'));
        }
        $this->assertCount(4, $document->querySelectorAll('[data-draft-form] [data-original-value]'));
        $this->assertNull($document->querySelector('.desk-list'));
        $this->assertNotNull($document->querySelector('.thread'));
    }

    /**
     * @return void
     */
    public function test_tracker_case_saves_details_status_and_reply_with_validation_and_escaping(): void
    {
        $this->withCookie(config('casefile.layout.cookie'), 'tracker');
        $case = CaseRecord::query()->where('number', 'CASE-0016')->sole();
        $this->patch(route('cases.update', $case), ['issue' => '<script>issue</script>', 'notes' => 'Tracker notes', 'status' => 'in_progress'])
            ->assertRedirect(route('cases.show', $case).'#case-details');
        $this->get(route('cases.show', $case))->assertOk()->assertSee('<script>issue</script>')->assertDontSee('<script>issue</script>', false)
            ->assertSee('Tracker notes')->assertSee('In progress');
        $this->assertSame(CaseStatus::InProgress, $case->fresh()->status);
        $this->from(route('cases.show', $case))->post(route('cases.replies.store', $case), ['body' => ['bad']])->assertSessionHasErrors('body');
        $this->get(route('cases.show', $case))->assertOk()->assertSee('aria-invalid="true"', false);
        $this->post(route('cases.replies.store', $case), ['body' => 'Tracker reply.'])->assertRedirect();
        $this->get(route('cases.show', $case))->assertOk()->assertSee('Tracker reply.');
    }

    /**
     * @return void
     */
    public function test_each_valid_choice_marks_the_switcher_and_has_working_index_and_case_views(): void
    {
        foreach (WorkspaceLayout::cases() as $choice) {
            $this->post('/layout', ['layout' => $choice->value])->assertRedirect(route('home'))->assertCookie(config('casefile.layout.cookie'), $choice->value);
            $this->withCookie(config('casefile.layout.cookie'), $choice->value);
            foreach (['/', '/cases/CASE-0016', '/search', '/settings', '/inbox'] as $url) {
                $response = $this->get($url)->assertOk()->assertViewHas('layout', $choice);
                if ($url === '/' || $url === '/cases/CASE-0016') {
                    $response->assertViewIs('workspace.'.$choice->value.'.'.($url === '/' ? 'index' : 'show'));
                }
                $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
                $active = $document->querySelectorAll('.layout-switcher button[aria-current="true"]');
                $this->assertCount(1, $active);
                $this->assertStringContainsString($choice->label(), $active[0]->textContent);
                $this->assertCount(4, $document->querySelectorAll('.layout-switcher form:has(input[name="layout"])'));
                foreach ($document->querySelectorAll('.layout-switcher form:has(input[name="layout"])') as $form) {
                    $this->assertNotNull($form->querySelector('input[name="_token"]'));
                    $this->assertTrue($form->hasAttribute('data-pending'));
                }
                $response->assertDontSee(' style="', false);
            }
        }
    }

    /**
     * @return void
     */
    public function test_switcher_carries_the_current_query_and_post_returns_to_it(): void
    {
        $target = route('search', ['page' => 2, 'q' => 'water', 'status' => ['open', 'closed']]);
        $response = $this->withCookie(config('casefile.layout.cookie'), 'desk')->get($target)->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertSame($target, $document->querySelector('.layout-switcher input[name="intended"]')->getAttribute('value'));
        $this->post('/layout', ['layout' => 'tracker', 'intended' => $target])->assertRedirect($target);
    }

    /**
     * @return array<string, array{mixed}>
     */
    public static function unsafeTargets(): array
    {
        return [
            'external' => ['https://evil.example/casefile/'],
            'scheme relative' => ['//evil.example/casefile/'],
            'javascript' => ['javascript:alert(1)'],
            'relative' => ['search?q=water'],
            'wrong scheme' => ['http://demo.example/casefile/search'],
            'wrong port' => ['https://demo.example:444/casefile/search'],
            'userinfo' => ['https://name:secret@demo.example/casefile/search'],
            'prefix sibling' => ['https://demo.example/casefiles/search'],
            'outside prefix' => ['https://demo.example/other/search'],
            'traversal' => ['/casefile/../search'],
            'encoded traversal' => ['/casefile/%2e%2e/search'],
            'double encoded traversal' => ['/casefile/%252e%252e%252fsearch'],
            'encoded slash and traversal' => ['/casefile/a%2f..%2f..%2fsearch'],
            'backslash' => ['/casefile/\\evil.example'],
            'encoded backslash' => ['/casefile/%5cevil.example'],
            'newline' => ["/casefile/search\nLocation:https://evil.example"],
            'encoded newline' => ['/casefile/%0asearch'],
            'malformed' => ['https://demo.example:invalid/casefile/'],
        ];
    }

    /**
     * @param  mixed  $target
     * @return void
     */
    #[DataProvider('unsafeTargets')]
    public function test_choice_rejects_unsafe_redirects_from_body_and_session(mixed $target): void
    {
        config(['app.url' => 'https://demo.example/casefile']);
        URL::forceRootUrl(config('app.url'));
        $this->post('https://demo.example/layout', ['layout' => 'tracker', 'intended' => $target])->assertRedirect(route('home'));
        $this->withSession(['layout.intended' => $target])->post('https://demo.example/layout', ['layout' => 'tracker'])->assertRedirect(route('home'));
    }

    /**
     * @return void
     */
    public function test_prefixed_app_has_a_scoped_secure_cookie_and_accepts_only_its_origin_and_prefix(): void
    {
        config(['app.url' => 'https://demo.example/casefile/']);
        URL::forceRootUrl(config('app.url'));
        $target = 'https://demo.example/casefile/cases/CASE-0016?search%5Bq%5D=water&page=2';
        $response = $this->post('https://demo.example/layout', ['layout' => 'tracker', 'intended' => $target])->assertRedirect($target);
        $cookie = $response->getCookie(config('casefile.layout.cookie'));
        $this->assertSame('/casefile', $cookie->getPath());
        $this->assertTrue($cookie->isSecure());
        $relative = $this->post('https://demo.example/layout', ['layout' => 'desk', 'intended' => '/casefile/search?q=water%20leak']);
        $this->assertSame('https://demo.example/casefile/search?q=water%20leak', $relative->headers->get('Location'));
        $this->assertSame('https://demo.example/casefile', app(LayoutResolver::class)->redirectTarget('/casefile'));
        $this->assertSame($target, app(LayoutResolver::class)->redirectTarget($target));
    }

    /**
     * @return void
     */
    public function test_root_deployment_relative_return_keeps_the_origin_port_query_and_fragment(): void
    {
        $target = '/search?q=water%20leak&status%5B0%5D=open#results';
        $relative = $this->post('/layout', ['layout' => 'tracker', 'intended' => $target]);
        $this->assertSame('http://localhost:8000'.$target, $relative->headers->get('Location'));
    }

    /**
     * @return void
     */
    public function test_wrong_shaped_intended_input_has_errors_and_picker_remains_renderable(): void
    {
        $this->from('/layout')->post('/layout', ['layout' => 'tracker', 'intended' => ['https://evil.example']])->assertSessionHasErrors('intended');
        $this->get('/layout')->assertOk();
        $this->assertSame(route('home'), app(LayoutResolver::class)->redirectTarget(['bad']));
    }

    /**
     * @return void
     */
    public function test_subdirectory_http_entry_picker_choice_and_return_preserve_the_case_query(): void
    {
        config(['app.url' => 'https://demo.example/casefile']);
        URL::forceRootUrl(config('app.url'));
        URL::forceScheme('https');
        $this->withServerVariables([
            'SCRIPT_NAME' => '/casefile/index.php',
            'SCRIPT_FILENAME' => '/var/www/demo_stuff/case-management-system/public/index.php',
            'PHP_SELF' => '/casefile/index.php',
        ]);
        $target = 'https://demo.example/casefile/cases/CASE-0016?page=2&search%5Bq%5D=water&status=open';
        $this->get($target)->assertRedirect('https://demo.example/casefile/layout')->assertSessionHas('layout.intended', $target);
        $response = $this->get('https://demo.example/casefile/layout')->assertOk();
        $document = HTMLDocument::createFromString($response->getContent(), LIBXML_NOERROR);
        $this->assertSame('https://demo.example/casefile/layout', $document->querySelector('.layout-choice')->getAttribute('action'));
        $this->assertSame($target, $document->querySelector('.layout-choice input[name="intended"]')->getAttribute('value'));
        $choice = $this->post('https://demo.example/casefile/layout', ['layout' => 'tracker', 'intended' => $target])->assertRedirect($target);
        $this->assertSame('/casefile', $choice->getCookie(config('casefile.layout.cookie'))->getPath());
        $this->withCookie(config('casefile.layout.cookie'), 'tracker')->get($target)->assertOk()->assertViewIs('workspace.tracker.show')
            ->assertSee('Back to search')->assertSee('https://demo.example/casefile/search?q=water');
    }

    /**
     * @return void
     */
    public function test_cookie_survives_a_real_demo_reset_and_tracker_still_renders(): void
    {
        $this->withCookie(config('casefile.layout.cookie'), 'tracker');
        $before = session(config('casefile.sandbox.session_key'));
        $this->post('/demo/reset')->assertRedirect(route('home'))->assertCookieMissing(config('casefile.layout.cookie'));
        $this->assertNotSame($before, session(config('casefile.sandbox.session_key')));
        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertViewIs('workspace.tracker.index')->assertViewHas('layout', WorkspaceLayout::Tracker);
    }

    /**
     * @return void
     */
    public function test_guest_and_csrf_guards_and_choice_throttling_apply(): void
    {
        Auth::logout();
        $this->get('/layout')->assertRedirect(route('sign-in'));
        $this->post('/layout', ['layout' => 'tracker'])->assertRedirect(route('sign-in'));
        $this->post('/sign-in/google')->assertRedirect(route('layout.picker'));
        config(['casefile.actions.attempts_per_minute' => 2]);
        $this->post('/layout', ['layout' => 'tracker'])->assertRedirect();
        $this->post('/layout', ['layout' => 'desk'])->assertRedirect();
        $this->post('/layout', ['layout' => 'board'])->assertTooManyRequests();
        $this->app['env'] = 'local';
        $this->post('/layout', ['layout' => 'tracker'])->assertStatus(419);
    }
}
