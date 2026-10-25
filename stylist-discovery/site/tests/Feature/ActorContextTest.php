<?php

namespace Tests\Feature;

use App\Enums\AccountRole;
use App\Models\User;
use App\Services\AccountService;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Support\BuildsAccountRuntime;
use Tests\Support\ConcurrentProcesses;
use Tests\TestCase;

class ActorContextTest extends TestCase
{
    use BuildsAccountRuntime;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildAccountRuntime();
    }

    /**
     * @return void
     */
    public function test_fresh_entry_requires_csrf_before_allocating_any_sandbox(): void
    {
        $this->get('/')->assertOk();
        $this->withCookie('strand_city_session', session()->getId());
        $csrf = session()->token();
        $ownedFiles = glob($this->fixtureDirectory.'/*.sqlite');
        $this->withMiddleware(PreventRequestForgery::class);
        app()->instance('env', 'csrf-test');
        try {
            $this->post('/demo/enter')->assertStatus(419);
            $this->post('/demo/enter', ['_token' => 'invalid'])->assertStatus(419);
            $this->assertDatabaseCount('sandboxes', 0, 'registry');
            $this->assertSame($ownedFiles, glob($this->fixtureDirectory.'/*.sqlite'));
            $this->assertFalse(session()->has('sandbox_token'));
            $this->assertFalse(session()->has('sandbox_generation'));
            $sessionId = session()->getId();
            $payload = json_decode(app('encrypter')->decrypt(session()->driver()->getHandler()->read($sessionId)), true, flags: JSON_THROW_ON_ERROR);
            $this->assertArrayNotHasKey('sandbox_token', $payload);
            $this->assertArrayNotHasKey('sandbox_generation', $payload);
            $this->post('/demo/enter', ['_token' => $csrf])->assertRedirect('/demo/ready');
            $this->assertDatabaseCount('sandboxes', 1, 'registry');
            $this->assertCount(count($ownedFiles) + 1, glob($this->fixtureDirectory.'/*.sqlite'));
        } finally {
            app()->instance('env', 'testing');
        }
    }

    /**
     * @return void
     */
    public function test_forged_missing_and_other_session_contexts_are_rejected(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $this->patch('/account', ['name' => 'Forged', '_actor_context' => $context.'bad'])->assertStatus(409);
        $this->patch('/account', ['name' => 'Missing'])->assertStatus(409);
        $this->post('/logout', ['_actor_context' => ['bad']])->assertStatus(409);
        $otherSession = $this->sandboxSession();
        $otherSession->put(['actor_revision' => session()->get('actor_revision'), 'sandbox_generation' => session()->get('sandbox_generation')]);
        $this->admitAccountFixture();
        $otherContext = app(AccountService::class)->signedContext($otherSession, User::query()->where('role', AccountRole::Client)->sole());
        $this->patch('/account', ['name' => 'Other session', '_actor_context' => $otherContext])->assertStatus(409);
        $this->admitAccountFixture();
        $this->assertSame('Client Fictional', User::query()->where('role', AccountRole::Client)->sole()->name);
    }

    /**
     * @return void
     */
    public function test_context_is_checked_before_route_binding(): void
    {
        $bindingRan = false;
        Route::bind('probe', function (string $value) use (&$bindingRan): string {
            $bindingRan = true;

            return $value;
        });
        Route::middleware(['web', 'sandbox', 'actor', 'auth'])->post('/context-probe/{probe}', fn () => response('unsafe'));
        $this->enterAccountDemo();
        $this->post('/context-probe/1', ['_actor_context' => 'forged'])->assertStatus(409);
        $this->assertFalse($bindingRan);
    }

    /**
     * @return void
     */
    public function test_old_client_form_after_stylist_switch_is_rejected(): void
    {
        $bookingActionRan = false;
        Route::middleware(['web', 'sandbox', 'actor', 'auth', 'role:client'])->post('/client-booking-probe', function () use (&$bookingActionRan) {
            $bookingActionRan = true;

            return response()->noContent();
        });
        $clientContext = $this->formContext($this->enterAccountDemo());
        $clientCsrf = session()->token();
        $this->post('/demo/role', ['_actor_context' => $clientContext, 'role' => 'stylist'])->assertRedirect('/workspace');
        $this->withCookie('strand_city_session', session()->getId());
        $stylistContext = $this->formContext($this->get('/account')->assertOk());
        $this->withMiddleware(PreventRequestForgery::class);
        app()->instance('env', 'csrf-test');
        try {
            $this->post('/client-booking-probe', ['_actor_context' => $clientContext, '_token' => $clientCsrf])->assertStatus(409);
        } finally {
            app()->instance('env', 'testing');
        }
        $this->post('/demo/role', ['_actor_context' => $stylistContext, 'role' => 'client'])->assertRedirect('/workspace');
        $this->withCookie('strand_city_session', session()->getId());
        $this->post('/client-booking-probe', ['_actor_context' => $clientContext])->assertStatus(409);
        $this->assertFalse($bookingActionRan);
        $this->admitAccountFixture();
        $this->assertDatabaseCount('bookings', 0, 'visitor');
    }

    /**
     * @return void
     */
    public function test_anonymous_login_and_signup_forms_stale_after_identity_change(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $this->post('/logout', ['_actor_context' => $context])->assertRedirect('/login');
        $this->withCookie('strand_city_session', session()->getId());
        $anonymousContext = $this->formContext($this->get('/login')->assertOk());
        $this->get('/register')->assertOk()->assertSee('Create account');
        $this->post('/login', ['_actor_context' => $anonymousContext, 'email' => config('demo.seed_accounts.client'), 'password' => $this->accountPassword])->assertRedirect('/demo/ready');
        $this->withCookie('strand_city_session', session()->getId());
        $this->post('/login', ['_actor_context' => $anonymousContext, 'email' => config('demo.seed_accounts.stylist'), 'password' => $this->accountPassword])->assertStatus(409);
        $this->post('/register', ['_actor_context' => $anonymousContext, 'name' => 'Stale', 'email' => 'stale@account.example', 'role' => 'client', 'password' => $this->accountPassword, 'password_confirmation' => $this->accountPassword])->assertStatus(409);
        $this->admitAccountFixture();
        $this->assertDatabaseCount('users', 3, 'visitor');
    }

    /**
     * @return void
     */
    public function test_missing_csrf_is_419_with_forgery_middleware_explicitly_enabled(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $this->withMiddleware(PreventRequestForgery::class);
        app()->instance('env', 'csrf-test');
        try {
            $this->patch('/account', ['_actor_context' => $context, 'name' => 'Unsafe'])->assertStatus(419);
            $this->patch('/account', ['_actor_context' => $context, '_token' => session()->token(), 'name' => 'Safe Name'])->assertRedirect('/account');
        } finally {
            app()->instance('env', 'testing');
        }
        $this->admitAccountFixture();
        $this->assertSame('Safe Name', User::query()->where('role', AccountRole::Client)->sole()->name);
    }

    /**
     * @return void
     */
    public function test_parallel_role_switch_cannot_restore_old_session(): void
    {
        $form = $this->enterAccountDemo();
        $oldId = session()->getId();
        $oldRevision = session()->get('actor_revision');
        $oldContext = $this->formContext($form);
        $cookie = $form->getCookie('strand_city_session', false)->getValue();
        $arguments = collect(['first', 'second'])->map(fn (string $signal): string => json_encode(['root' => $this->fixtureDirectory, 'cookie' => $cookie, 'context' => $oldContext, 'signal' => $signal], JSON_THROW_ON_ERROR));
        DB::purge('visitor');
        $processes = ConcurrentProcesses::run(base_path('tests/Support/account-worker.php'), $arguments);
        try {
            $this->awaitSignal('first');
            $this->awaitSignal('second');
            file_put_contents($this->fixtureDirectory.'/go', 'go');
            $results = $processes->map(function ($process): array {
                $process->wait();
                $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput().$process->getOutput());

                return json_decode($process->getOutput(), true, flags: JSON_THROW_ON_ERROR);
            });
            $this->assertEqualsCanonicalizing([302, 409], $results->pluck('status')->all());
            $this->assertSame(0, $results->firstWhere('status', 409)['cookies']);
            $rows = DB::connection('registry')->table('sessions')->get();
            $this->assertCount(1, $rows);
            $this->assertNotSame($oldId, $rows->sole()->id);
            $handler = app('session')->driver()->getHandler();
            $payload = json_decode(app('encrypter')->decrypt($handler->read($rows->sole()->id)), true, flags: JSON_THROW_ON_ERROR);
            $this->assertNotSame($oldRevision, $payload['actor_revision']);
            $this->withCookie('strand_city_session', $oldId)->post('/demo/role', ['_actor_context' => $oldContext, 'role' => 'admin'])->assertStatus(409)->assertHeaderMissing('Set-Cookie');
            $persisted = DB::connection('registry')->table('sessions')->sole();
            $this->assertSame($rows->sole()->payload, $persisted->payload);
            $this->withCookie('strand_city_session', $persisted->id);
            $this->get('/account')->assertOk()->assertSee('Stylist Fictional');
            $this->assertSame($payload['actor_revision'], session()->get('actor_revision'));
        } finally {
            foreach ($processes as $process) {
                if ($process->isRunning()) {
                    $process->stop();
                }
            }
        }
    }
}
