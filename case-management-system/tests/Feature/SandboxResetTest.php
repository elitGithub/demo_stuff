<?php

namespace Tests\Feature;

use App\Models\User;
use App\Sandbox\SandboxStore;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Pdo\Sqlite;
use Tests\Support\BuildsTemplateFile;
use Tests\TestCase;

class SandboxResetTest extends TestCase
{
    use BuildsTemplateFile;

    private const string RESET_COPY = 'Your demo was reset.';

    private const string LIMIT_COPY = 'Too many demo sessions from this address; try again in an hour.';

    private const string CONFIRM_COPY = 'This discards everything you changed in your demo and starts a fresh copy. Continue?';

    private const string LIMIT_KEY = 'sandbox:127.0.0.1';

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->withCookie(config('casefile.layout.cookie'), 'desk');
        $this->buildTemplate();
        config(['casefile.mode' => 'demo']);
    }

    /**
     * @return string
     */
    private function signIn(): string
    {
        $this->post('/sign-in/google')->assertRedirect(route('home'));
        Auth::forgetGuards();

        return session(config('casefile.sandbox.session_key'));
    }

    /**
     * @param  string  $id
     * @return string
     */
    private function pathOf(string $id): string
    {
        return config('casefile.sandbox.directory').DIRECTORY_SEPARATOR.$id.'.sqlite';
    }

    /**
     * @see App\Http\Controllers\SandboxResetController
     */
    public function test_reset_swaps_in_a_fresh_sandbox_and_keeps_the_visitor_signed_in(): void
    {
        $before = $this->signIn();
        DB::table('users')->where('id', 1)->update(['name' => 'Changed before reset']);

        $this->post('/demo/reset')
            ->assertRedirect(route('home'))
            ->assertSessionHas('status', self::RESET_COPY);

        $after = session(config('casefile.sandbox.session_key'));

        $this->assertNotSame($before, $after);
        $this->assertFileDoesNotExist($this->pathOf($before));
        $this->assertFileExists($this->pathOf($after));
        $this->assertSame($this->pathOf($after), DB::connection()->getDatabaseName());
        $this->assertCount(1, File::glob(config('casefile.sandbox.directory').'/*.sqlite'));

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertSee(self::RESET_COPY);
        $this->assertAuthenticated();
        $this->assertSame($this->pathOf($after), DB::connection()->getDatabaseName());
        $this->assertSame('Dana Whitfield', DB::table('users')->where('id', 1)->value('name'));
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_sandbox_deleted_after_sign_in_is_replaced_on_the_next_page(): void
    {
        $before = $this->signIn();
        File::delete($this->pathOf($before));

        $this->get('/')->assertOk()->assertSee(self::RESET_COPY);

        $after = session(config('casefile.sandbox.session_key'));

        $this->assertAuthenticated();
        $this->assertNotSame($before, $after);
        $this->assertFileExists($this->pathOf($after));
        $this->assertSame($this->pathOf($after), DB::connection()->getDatabaseName());
        $this->assertNotNull(app(SandboxStore::class)->resolve($after));
        $this->assertSame(2, RateLimiter::attempts(self::LIMIT_KEY));

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertDontSee(self::RESET_COPY);
        $this->assertSame($after, session(config('casefile.sandbox.session_key')));
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_stale_sandbox_is_replaced_on_the_next_page(): void
    {
        $before = $this->signIn();
        (new Sqlite('sqlite:'.$this->pathOf($before)))->exec("update installation_meta set schema_version = 'stale'");

        $this->get('/')->assertOk()->assertSee(self::RESET_COPY);

        $this->assertAuthenticated();
        $this->assertNotSame($before, session(config('casefile.sandbox.session_key')));
        $this->assertFileDoesNotExist($this->pathOf($before));
        $this->assertCount(1, File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
    }

    /**
     * @see App\Sandbox\SandboxStore::resolve()
     */
    public function test_an_expired_sandbox_is_replaced_on_the_next_page(): void
    {
        $before = $this->signIn();
        touch($this->pathOf($before), now()->subHours(25)->getTimestamp());

        $this->get('/')->assertOk()->assertSee(self::RESET_COPY);

        $after = session(config('casefile.sandbox.session_key'));
        $this->assertNotSame($before, $after);
        $this->assertFileDoesNotExist($this->pathOf($before));
        $this->assertSame($this->pathOf($after), DB::connection()->getDatabaseName());
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_redirect_after_a_lost_sandbox_carries_the_notice_to_the_page_it_lands_on(): void
    {
        $before = $this->signIn();
        File::delete($this->pathOf($before));

        $this->get('/sign-in')->assertRedirect('/');

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertSee(self::RESET_COPY);

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertDontSee(self::RESET_COPY);
    }

    /**
     * @see App\Http\Controllers\SandboxResetController
     */
    public function test_reset_with_a_lost_sandbox_costs_one_attempt(): void
    {
        $before = $this->signIn();
        File::delete($this->pathOf($before));

        $this->post('/demo/reset')->assertRedirect(route('home'));

        $this->assertSame(2, RateLimiter::attempts(self::LIMIT_KEY));
        $this->assertCount(1, File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
        $this->assertFileExists($this->pathOf(session(config('casefile.sandbox.session_key'))));

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertSee(self::RESET_COPY);
    }

    /**
     * @see App\Http\Controllers\SignInController::signOut()
     */
    public function test_sign_out_leaves_a_healthy_demo_sandbox_for_sweeping_and_invalidates_the_session(): void
    {
        $before = $this->signIn();
        $sessionId = session()->getId();
        $token = session()->token();

        $this->withSession(['marker' => 'kept'])->post('/sign-out')->assertRedirect(route('sign-in'));

        $this->assertFileExists($this->pathOf($before));
        $this->assertSame([$this->pathOf($before)], File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
        $this->assertGuest();
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
        $this->assertFalse(session()->has('marker'));
        $this->assertNotSame($sessionId, session()->getId());
        $this->assertNotSame($token, session()->token());

        Auth::forgetGuards();
        $this->get('/')->assertRedirect(route('sign-in'));
    }

    /**
     * @see App\Http\Controllers\SignInController::signOut()
     */
    public function test_sign_out_discards_a_same_request_replacement_for_a_lost_demo_sandbox(): void
    {
        $lost = $this->signIn();
        $kept = app(SandboxStore::class)->provision('198.51.100.32');
        File::delete($this->pathOf($lost));

        $this->post('/sign-out')->assertRedirect(route('sign-in'));

        $this->assertSame([$kept->path], File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
        $this->assertFileExists($kept->path);
        $this->assertSame(2, RateLimiter::attempts(self::LIMIT_KEY));
        $this->assertGuest();
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
    }

    /**
     * @see App\Http\Controllers\SignInController::signOut()
     */
    public function test_sign_out_discards_a_same_request_replacement_for_an_expired_demo_sandbox(): void
    {
        $expired = $this->signIn();
        touch($this->pathOf($expired), now()->subHours(25)->getTimestamp());

        $this->post('/sign-out')->assertRedirect(route('sign-in'));

        $this->assertFileDoesNotExist($this->pathOf($expired));
        $this->assertSame([], File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
        $this->assertSame(2, RateLimiter::attempts(self::LIMIT_KEY));
        $this->assertGuest();
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
    }

    /**
     * @see App\Http\Controllers\SignInController::signOut()
     */
    public function test_local_sign_out_preserves_a_retained_sandbox_even_with_a_same_request_start_marker(): void
    {
        config(['casefile.mode' => 'local']);
        $session = app('session.store');
        $session->start();
        $handle = app(SandboxStore::class)->start($session, '127.0.0.1');
        $sessionId = $session->getId();
        $token = $session->token();

        $this->actingAs(new User(['id' => 1, 'name' => 'Local owner']))
            ->withSession(['marker' => 'kept'])
            ->post('/sign-out')
            ->assertRedirect(route('sign-in'));

        $this->assertFileExists($handle->path);
        $this->assertGuest();
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
        $this->assertFalse(session()->has('marker'));
        $this->assertNotSame($sessionId, session()->getId());
        $this->assertNotSame($token, session()->token());
    }

    /**
     * @see App\Http\Controllers\SignInController::signOut()
     */
    public function test_local_sign_out_invalidates_a_session_with_a_malformed_retained_sandbox_id(): void
    {
        config(['casefile.mode' => 'local']);
        $this->withoutExceptionHandling();
        $session = app('session.store');
        $session->start();
        $sessionId = $session->getId();
        $token = $session->token();

        $this->actingAs(new User(['id' => 1, 'name' => 'Local owner']))
            ->withSession([
                config('casefile.sandbox.session_key') => '../template',
                'casefile_sandbox_started_this_request' => '../template',
                'marker' => 'kept',
            ])
            ->post('/sign-out')
            ->assertRedirect(route('sign-in'));

        $this->assertGuest();
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
        $this->assertFalse(session()->has('marker'));
        $this->assertNotSame($sessionId, session()->getId());
        $this->assertNotSame($token, session()->token());
        $this->assertDirectoryDoesNotExist(config('casefile.sandbox.directory'));
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_a_guest_with_a_stale_id_signs_in_for_one_attempt_and_no_reset_notice(): void
    {
        $stale = app(SandboxStore::class)->provision('198.51.100.30');
        (new Sqlite('sqlite:'.$stale->path))->exec("update installation_meta set schema_version = 'stale'");

        $this->withSession([config('casefile.sandbox.session_key') => $stale->id])->post('/sign-in/google')->assertRedirect(route('home'));

        $this->assertSame(1, RateLimiter::attempts(self::LIMIT_KEY));
        $this->assertFileDoesNotExist($stale->path);
        $this->assertCount(1, File::glob(config('casefile.sandbox.directory').'/*.sqlite'));

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertDontSee(self::RESET_COPY);
        $this->assertAuthenticated();
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_signing_in_again_replaces_a_live_prior_sandbox(): void
    {
        $prior = app(SandboxStore::class)->provision('198.51.100.31');

        $this->withSession([config('casefile.sandbox.session_key') => $prior->id])->post('/sign-in/google')->assertRedirect(route('home'));

        $this->assertFileDoesNotExist($prior->path);
        $this->assertNotSame($prior->id, session(config('casefile.sandbox.session_key')));
        $this->assertSame(1, RateLimiter::attempts(self::LIMIT_KEY));
        $this->assertCount(1, File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
    }

    /**
     * @see resources/js/confirm.js
     */
    public function test_the_confirm_module_runs_before_the_pending_module_and_cancels_a_declined_submit(): void
    {
        $app = file_get_contents(resource_path('js/app.js'));
        $confirm = file_get_contents(resource_path('js/confirm.js'));
        $styles = file_get_contents(resource_path('css/app.css'));

        $this->assertLessThan(strpos($app, "import './pending.js';"), strpos($app, "import './confirm.js';"));
        $this->assertStringContainsString("hasAttribute('data-confirm')", $confirm);
        $this->assertStringContainsString("if (!window.confirm(form.getAttribute('data-confirm'))) {", $confirm);
        $this->assertStringContainsString('event.preventDefault();', $confirm);
        $this->assertMatchesRegularExpression('~\},\s*true,\s*\);\s*\z~', $confirm);
        $this->assertMatchesRegularExpression('~@layer components \{.*\.btn-danger \{\s*border-color: var\(--danger\);\s*color: var\(--danger\);\s*\}~s', $styles);
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_signed_in_session_without_a_sandbox_id_gets_one(): void
    {
        $this->withSession([Auth::guard()->getName() => 1])->get('/')->assertOk()->assertSee(self::RESET_COPY);

        $id = session(config('casefile.sandbox.session_key'));

        $this->assertAuthenticated();
        $this->assertFileExists($this->pathOf($id));
        $this->assertSame($this->pathOf($id), DB::connection()->getDatabaseName());
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_replaced_sandbox_on_a_form_post_carries_the_notice_to_the_next_page(): void
    {
        Route::middleware(['web', 'auth'])->post('/testing/form-post', fn () => redirect()->route('home'));
        $before = $this->signIn();
        File::delete($this->pathOf($before));

        $this->post('/testing/form-post')->assertRedirect(route('home'));

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertSee(self::RESET_COPY);
        $this->assertFileExists($this->pathOf(session(config('casefile.sandbox.session_key'))));

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertDontSee(self::RESET_COPY);
    }

    /**
     * @see resources/views/components/app-layout.blade.php
     */
    public function test_the_reset_control_shows_beside_sign_out_only_in_demo_mode_when_signed_in(): void
    {
        $this->get('/sign-in')->assertOk()->assertDontSee('Reset my demo')->assertDontSee('action="'.route('demo.reset').'"', false);

        $this->signIn();

        $this->get('/')
            ->assertOk()
            ->assertSee('<form method="POST" action="'.route('demo.reset').'" data-pending data-confirm="'.self::CONFIRM_COPY.'">', false)
            ->assertSee('<button type="submit" class="btn btn-danger">Reset my demo</button>', false)
            ->assertSee('<button type="submit" class="btn">Sign out</button>', false)
            ->assertSeeInOrder(['Reset my demo', 'Sign out'])
            ->assertSee('action="'.route('sign-out').'" data-pending', false);

        config(['casefile.mode' => 'local']);
        $this->actingAs(new User(['name' => 'Local owner']));
        $html = Blade::render('<x-app-layout title="Local">Body</x-app-layout>');

        $this->assertStringContainsString('action="'.route('sign-out').'" data-pending', $html);
        $this->assertStringNotContainsString('Reset my demo', $html);
        $this->assertStringNotContainsString(route('demo.reset'), $html);
    }

    /**
     * @see App\Http\Controllers\SandboxResetController
     */
    public function test_reset_is_not_found_outside_demo_mode(): void
    {
        config(['casefile.mode' => 'local']);
        $this->actingAs(new User(['name' => 'Local owner']));

        $this->post('/demo/reset')->assertNotFound();

        $this->assertDirectoryDoesNotExist(config('casefile.sandbox.directory'));
    }

    /**
     * @see routes/web.php
     */
    public function test_a_guest_cannot_reset(): void
    {
        $this->post('/demo/reset')->assertRedirect('/sign-in');

        $this->assertDirectoryDoesNotExist(config('casefile.sandbox.directory'));
    }

    /**
     * @see App\Http\Controllers\SandboxResetController
     */
    public function test_a_refused_reset_keeps_the_current_sandbox_and_the_session(): void
    {
        $current = $this->signIn();
        $store = app(SandboxStore::class);

        for ($attempt = 2; $attempt <= 5; $attempt++) {
            $store->provision('127.0.0.1');
        }

        $this->post('/demo/reset')->assertStatus(429)->assertSee(self::LIMIT_COPY)->assertSee('Sign out');

        $this->assertAuthenticated();
        $this->assertSame($current, session(config('casefile.sandbox.session_key')));
        $this->assertFileExists($this->pathOf($current));

        Auth::forgetGuards();
        $this->get('/')->assertOk()->assertDontSee(self::RESET_COPY);
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_lost_sandbox_past_the_limit_shows_the_limit_page_and_signs_the_visitor_out(): void
    {
        $before = $this->signIn();
        $store = app(SandboxStore::class);

        for ($attempt = 2; $attempt <= 5; $attempt++) {
            $store->provision('127.0.0.1');
        }

        File::delete($this->pathOf($before));
        config(['database.connections.sqlite.database' => ':memory:']);
        DB::purge('sqlite');

        $this->get('/')->assertStatus(429)->assertSee(self::LIMIT_COPY)->assertDontSee('Sign out');

        $this->assertGuest();
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
        $this->get('/')->assertRedirect('/sign-in');
    }
}
