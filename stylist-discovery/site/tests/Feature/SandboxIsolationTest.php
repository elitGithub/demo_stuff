<?php

namespace Tests\Feature;

use App\Http\Middleware\BindSandbox;
use App\Models\Registry\Sandbox;
use App\Models\User;
use App\Services\SandboxService;
use App\Session\RegistrySessionHandler;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsSandboxRuntime;
use Tests\TestCase;

class SandboxIsolationTest extends TestCase
{
    use BuildsSandboxRuntime;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildSandboxRuntime();
    }

    /**
     * @return void
     */
    public function test_overlapping_ids_stay_in_separate_files(): void
    {
        $service = app(SandboxService::class);
        $first = $this->sandboxSession();
        $second = $this->sandboxSession();
        $firstContext = $service->enter($first, '192.0.2.1', CarbonImmutable::now());
        User::query()->findOrFail(1)->update(['name' => 'Changed only in A']);
        $secondContext = $service->enter($second, '192.0.2.2', CarbonImmutable::now());
        $this->assertNotSame($firstContext->digest, $secondContext->digest);
        $this->assertNotSame('Changed only in A', User::query()->findOrFail(1)->name);
        $service->admit($first, CarbonImmutable::now());
        $this->assertSame('Changed only in A', User::query()->findOrFail(1)->name);
        $this->assertSame(2, Sandbox::query()->count());
        $this->assertSame($firstContext->generation, DB::connection('visitor')->table('sandbox_meta')->value('generation'));
    }

    /**
     * @return void
     */
    public function test_root_creates_only_a_bounded_registry_session_and_entry_authenticates(): void
    {
        $response = $this->get('/');
        $response->assertOk()->assertSee('Explore the demo')->assertCookie('strand_city_session');
        $this->assertSame(0, Sandbox::query()->count());
        $this->assertSame(1, DB::connection('registry')->table('sessions')->count());
        $row = DB::connection('registry')->table('sessions')->sole();
        $this->assertNull($row->ip_address);
        $this->assertNull($row->user_agent);
        $this->post('/demo/enter')->assertRedirect('/demo/ready');
        $this->assertSame(1, Sandbox::query()->count());
        $this->get('/demo/ready')->assertOk()->assertSee('Alex Morel');
        $this->get('/demo/start')->assertRedirect('/demo/ready');
        $this->assertSame(1, Sandbox::query()->count());
        $this->assertNull(config('database.connections.visitor'));
    }

    /**
     * @return void
     */
    public function test_expired_post_does_not_allocate_or_replay(): void
    {
        $this->get('/')->assertOk();
        $this->post('/demo/enter')->assertRedirect();
        Sandbox::query()->update(['expires_at' => CarbonImmutable::now()->subSecond()]);
        $before = glob($this->fixtureDirectory.'/*.sqlite');
        $this->post('/demo/enter')->assertStatus(410)->assertSee('/demo/start');
        $this->assertSame($before, glob($this->fixtureDirectory.'/*.sqlite'));
        $this->assertSame(1, Sandbox::query()->count());
        $this->get('/demo/start')->assertOk()->assertSee('Explore the demo');
        $this->assertSame(1, Sandbox::query()->count());
    }

    /**
     * @return void
     */
    public function test_missing_active_file_is_not_recreated(): void
    {
        $service = app(SandboxService::class);
        $session = $this->sandboxSession();
        $context = $service->enter($session, '192.0.2.1', CarbonImmutable::now());
        DB::purge('visitor');
        $path = $service->path($context->digest.'.sqlite');
        unlink($path);
        $request = Request::create('/demo/ready');
        $request->setLaravelSession($session);
        try {
            (new BindSandbox)->handle($request, fn () => new Response('unsafe'));
            $this->fail('Missing visitor was admitted.');
        } catch (HttpException $exception) {
            $this->assertSame(503, $exception->getStatusCode());
            $this->assertSame('2', $exception->getHeaders()['Retry-After']);
        }
        $this->assertFileDoesNotExist($path);
    }

    /**
     * @return void
     */
    public function test_registry_and_session_caps_are_bounded(): void
    {
        $handler = new RegistrySessionHandler(DB::connection('registry'), 'sessions', 240);
        for ($index = 0; $index < 250; $index++) {
            $handler->write('session-'.$index, '{}');
        }
        $handler->write('session-0', '{"updated":true}');
        try {
            $handler->write('session-250', '{}');
            $this->fail('Session capacity was exceeded.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString('capacity:sessions', $exception->getMessage());
        }
        try {
            $handler->write('session-0', str_repeat('x', 16384));
            $this->fail('Oversized session was persisted.');
        } catch (HttpException $exception) {
            $this->assertSame(429, $exception->getStatusCode());
        }
        $this->assertSame(250, DB::connection('registry')->table('sessions')->count());
        $this->assertSame('{"updated":true}', $handler->read('session-0'));
        DB::connection('registry')->table('revoked_sessions')->insert(['digest' => hash('sha256', 'session-0'), 'expires_at' => CarbonImmutable::now()->addMinute()]);
        try {
            $handler->write('session-0', '{}');
            $this->fail('Revoked session was saved.');
        } catch (HttpException $exception) {
            $this->assertSame(409, $exception->getStatusCode());
        }
        app(SandboxService::class)->collectRegistry(CarbonImmutable::now()->addHours(5));
        $this->assertSame(150, DB::connection('registry')->table('sessions')->count());
        $this->assertSame(0, DB::connection('registry')->table('revoked_sessions')->count());
    }

    /**
     * @return void
     */
    public function test_revoked_request_does_not_read_or_save_session_or_emit_cookies(): void
    {
        $this->get('/')->assertOk();
        $row = DB::connection('registry')->table('sessions')->sole();
        DB::connection('registry')->table('revoked_sessions')->insert(['digest' => hash('sha256', $row->id), 'expires_at' => CarbonImmutable::now()->addMinute()]);
        $response = $this->withCookie('strand_city_session', $row->id)->get('/');
        $response->assertStatus(409)->assertHeaderMissing('Set-Cookie');
        $this->assertSame($row->payload, DB::connection('registry')->table('sessions')->sole()->payload);
    }

    /**
     * @return void
     */
    public function test_expired_cookie_outside_cleanup_batch_is_rejected_at_the_exact_boundary(): void
    {
        $now = CarbonImmutable::parse('2030-01-01 12:00:00', 'UTC');
        CarbonImmutable::setTestNow($now);
        try {
            $this->get('/')->assertOk();
            $row = DB::connection('registry')->table('sessions')->sole();
            $deadline = $now->subMinutes(config('session.lifetime'))->timestamp;
            DB::connection('registry')->table('sessions')->where('id', $row->id)->update(['last_activity' => $deadline + 1]);
            $this->withCookie('strand_city_session', $row->id)->get('/')->assertOk();
            for ($index = 0; $index < 201; $index++) {
                DB::connection('registry')->table('sessions')->insert(['id' => str_pad((string) $index, 40, 'z'), 'payload' => 'expired-fixture', 'last_activity' => $deadline - 201 + $index]);
            }
            DB::connection('registry')->table('sessions')->where('id', $row->id)->update(['last_activity' => $deadline]);
            $persisted = DB::connection('registry')->table('sessions')->where('id', $row->id)->sole();
            $this->get('/')->assertStatus(410)->assertHeaderMissing('Set-Cookie');
            $this->post('/demo/enter')->assertStatus(410)->assertHeaderMissing('Set-Cookie');
            $unchanged = DB::connection('registry')->table('sessions')->where('id', $row->id)->sole();
            $this->assertSame($persisted->payload, $unchanged->payload);
            $this->assertSame($deadline, $unchanged->last_activity);
            $this->assertSame(2, DB::connection('registry')->table('sessions')->count());
            $this->assertSame(0, Sandbox::query()->count());
            $this->get('/demo/start')->assertOk()->assertSee('Explore the demo');
            $this->assertSame(0, Sandbox::query()->count());
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    /**
     * @return void
     */
    public function test_lock_capacity_is_429_and_existing_lock_contention_remains_retryable_503(): void
    {
        $this->get('/')->assertOk();
        $session = DB::connection('registry')->table('sessions')->sole();
        for ($index = 0; $index < 100; $index++) {
            $key = $index === 0 ? config('cache.prefix').'session:'.$session->id : 'held-lock-'.$index;
            DB::connection('registry')->table('cache_locks')->insert(['key' => $key, 'owner' => 'another-request', 'expiration' => CarbonImmutable::now()->addMinutes(2)->timestamp]);
        }
        $this->get('/')->assertStatus(429)->assertHeaderMissing('Set-Cookie');
        $this->assertSame(100, DB::connection('registry')->table('cache_locks')->count());
        $this->withCookie('strand_city_session', $session->id)->get('/')->assertStatus(503)->assertHeader('Retry-After', '2')->assertHeaderMissing('Set-Cookie');
        $this->assertSame(100, DB::connection('registry')->table('cache_locks')->count());
        $this->assertSame($session->payload, DB::connection('registry')->table('sessions')->sole()->payload);
    }
}
