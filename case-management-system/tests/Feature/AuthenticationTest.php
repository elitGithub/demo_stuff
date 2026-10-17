<?php

namespace Tests\Feature;

use App\Actions\Auth\SignInOwner;
use App\Auth\SimulatedGoogleProvider;
use App\Contracts\SignInProvider;
use App\Data\OwnerIdentity;
use App\Exceptions\OwnerNotFound;
use App\Models\User;
use App\Providers\AppServiceProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    private const DEMO_SENTENCE = 'This is a demonstration. The mailbox is simulated and nothing here is real email.';

    private const PRIVATE_SENTENCE = 'You get your own private copy of the data; nothing you do is seen by anyone else.';

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
    }

    /**
     * @see routes/web.php
     */
    public function test_a_guest_opening_home_is_sent_to_sign_in(): void
    {
        $this->get('/')->assertRedirect('/sign-in');
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_google_sign_in_authenticates_the_owner_and_regenerates_the_session(): void
    {
        $before = str_repeat('a', 40);
        $cookie = config('session.cookie');

        $this->withCookie($cookie, $before)->get('/sign-in');
        $this->assertSame($before, session()->getId());

        $response = $this->withCookie($cookie, $before)->post('/sign-in/google');

        $response->assertRedirect(route('home'));
        $this->assertAuthenticatedAs(User::query()->findOrFail(1));
        $this->assertNotSame($before, session()->getId());
        $this->assertSame('simulated-google-owner', User::query()->findOrFail(1)->google_subject);
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_sign_in_returns_to_the_intended_page(): void
    {
        $this->withSession(['url.intended' => url('/elsewhere')])->post('/sign-in/google')->assertRedirect(url('/elsewhere'));
        $this->assertAuthenticated();
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_the_sign_in_form_carries_a_csrf_token(): void
    {
        $this->get('/sign-in')->assertSee('<input type="hidden" name="_token"', false);
    }

    /**
     * @see App\Http\Controllers\SignInController::signOut()
     */
    public function test_sign_out_ends_the_session_and_returns_to_sign_in(): void
    {
        $before = str_repeat('b', 40);

        $this->actingAs(User::query()->findOrFail(1))
            ->withCookie(config('session.cookie'), $before)
            ->withSession(['marker' => 'kept'])
            ->post('/sign-out')
            ->assertRedirect(route('sign-in'));

        $this->assertGuest();
        $this->assertFalse(session()->has('marker'));
        $this->assertNotSame($before, session()->getId());
        $this->get('/')->assertRedirect('/sign-in');
    }

    /**
     * @see bootstrap/app.php
     */
    public function test_a_non_owner_identity_is_redirected_to_sign_in_with_a_message(): void
    {
        $this->app->bind(SignInProvider::class, fn () => new class implements SignInProvider
        {
            /**
             * @return OwnerIdentity
             */
            public function authenticate(): OwnerIdentity
            {
                return new OwnerIdentity(email: 'stranger@casefile.example', name: 'Stranger', googleSubject: 'x');
            }
        });

        $this->post('/sign-in/google')
            ->assertRedirect(route('sign-in'))
            ->assertSessionHas('error', 'That Google account is not the owner of this Casefile.');
        $this->assertGuest();
    }

    /**
     * @see App\Providers\AppServiceProvider::boot()
     */
    public function test_the_eleventh_sign_in_in_a_minute_is_throttled(): void
    {
        for ($attempt = 1; $attempt <= 10; $attempt++) {
            $this->post('/sign-in/google')->assertRedirect(route('home'));
            Auth::logout();
        }

        $this->post('/sign-in/google')
            ->assertStatus(429)
            ->assertSee('Too many attempts from this address. Try again in a minute.');
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_sign_in_without_a_csrf_token_is_rejected(): void
    {
        $this->app['env'] = 'local';

        $this->post('/sign-in/google')->assertStatus(419);
        $this->assertGuest();
    }

    /**
     * @see resources/views/auth/sign-in.blade.php
     */
    public function test_the_demo_mode_page_has_the_simulated_label_and_both_sentences(): void
    {
        config(['casefile.mode' => 'demo']);

        $view = $this->view('auth.sign-in');

        $view->assertSee('Continue with Google (simulated)');
        $view->assertSee(self::DEMO_SENTENCE);
        $view->assertSee(self::PRIVATE_SENTENCE);
    }

    /**
     * @see App\Providers\AppServiceProvider::register()
     */
    public function test_demo_binds_the_provider_and_production_leaves_it_unbound(): void
    {
        unset($this->app[SignInProvider::class]);
        config(['casefile.mode' => 'production']);
        (new AppServiceProvider($this->app))->register();
        $this->assertFalse($this->app->bound(SignInProvider::class));

        config(['casefile.mode' => 'demo']);
        (new AppServiceProvider($this->app))->register();
        $this->assertInstanceOf(SimulatedGoogleProvider::class, $this->app->make(SignInProvider::class));
    }

    /**
     * @see App\Http\Controllers\SignInController::signOut()
     */
    public function test_a_guest_cannot_post_sign_out(): void
    {
        $this->post('/sign-out')->assertRedirect('/sign-in');
    }

    /**
     * @see resources/views/auth/sign-in.blade.php
     */
    public function test_the_page_shows_the_simulated_label_and_both_sentences_in_local_mode(): void
    {
        $response = $this->get('/sign-in');

        $response->assertOk();
        $response->assertSee('Continue with Google (simulated)');
        $response->assertSee(self::DEMO_SENTENCE);
        $response->assertSee(self::PRIVATE_SENTENCE);
        $response->assertSee('Turns emails from the people you choose into cases you can track.');
        $response->assertSee('<form method="POST" action="'.route('sign-in.google').'" data-pending>', false);
        $response->assertDontSee('Sign out');
    }

    /**
     * @see resources/views/auth/sign-in.blade.php
     */
    public function test_the_production_page_has_the_plain_label_and_no_demo_sentences(): void
    {
        config(['casefile.mode' => 'production']);

        $view = $this->view('auth.sign-in');

        $view->assertSee('Continue with Google');
        $view->assertDontSee('(simulated)');
        $view->assertDontSee(self::DEMO_SENTENCE);
        $view->assertDontSee(self::PRIVATE_SENTENCE);
    }

    /**
     * @see resources/views/components/app-layout.blade.php
     */
    public function test_sign_out_control_shows_only_when_signed_in(): void
    {
        $this->get('/sign-in')->assertDontSee('action="'.route('sign-out').'"', false);

        $this->actingAs(User::query()->findOrFail(1));

        $this->withCookie(config('casefile.layout.cookie'), 'desk')->get('/')->assertSee('action="'.route('sign-out').'" data-pending', false);
    }

    /**
     * @see App\Actions\Auth\SignInOwner
     */
    public function test_an_identity_that_is_not_the_owner_is_refused(): void
    {
        $identity = new OwnerIdentity(email: 'stranger@casefile.example', name: 'Stranger', googleSubject: 'x');

        try {
            app(SignInOwner::class)($identity);
            $this->fail('Expected OwnerNotFound.');
        } catch (OwnerNotFound $exception) {
            $this->assertSame('No owner account matches stranger@casefile.example.', $exception->getMessage());
        }

        $this->assertGuest();
    }

    /**
     * @see App\Actions\Auth\SignInOwner
     */
    public function test_the_email_match_ignores_case_and_surrounding_space_only(): void
    {
        $owner = app(SignInOwner::class)(new OwnerIdentity(
            email: '  DANA@Casefile.example ',
            name: 'Dana Whitfield',
            googleSubject: 'subject-2',
        ));

        $this->assertSame(1, $owner->id);
        $this->assertSame('subject-2', $owner->fresh()->google_subject);

        $this->expectException(OwnerNotFound::class);
        app(SignInOwner::class)(new OwnerIdentity(email: 'dana@casefile.example.evil', name: 'x', googleSubject: 'y'));
    }

    /**
     * @see routes/web.php
     */
    public function test_a_signed_in_visitor_opening_sign_in_is_sent_home(): void
    {
        $this->actingAs(User::query()->findOrFail(1));

        $this->get('/sign-in')->assertRedirect('/');
    }

    /**
     * @see App\Providers\AppServiceProvider::register()
     */
    public function test_the_provider_is_bound_in_local_mode(): void
    {
        $identity = app(SignInProvider::class)->authenticate();

        $this->assertSame(config('casefile.owner.email'), $identity->email);
        $this->assertSame(config('casefile.owner.name'), $identity->name);
        $this->assertSame('simulated-google-owner', $identity->googleSubject);
    }
}
