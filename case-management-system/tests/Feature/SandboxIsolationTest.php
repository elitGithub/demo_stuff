<?php

namespace Tests\Feature;

use App\Sandbox\SandboxStore;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\RateLimiter;
use Pdo\Sqlite;
use Tests\Support\BuildsTemplateFile;
use Tests\TestCase;

class SandboxIsolationTest extends TestCase
{
    use BuildsTemplateFile;

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
     * @param  string  $sessionId
     * @return static
     */
    private function asVisitor(string $sessionId): static
    {
        $this->flushSession();
        Auth::forgetGuards();

        return $this->withCookie(config('session.cookie'), $sessionId);
    }

    /**
     * @param  string  $path
     * @return string
     */
    private function ownerNameIn(string $path): string
    {
        return (new Sqlite('sqlite:'.$path))->query('select name from users where id = 1')->fetchColumn();
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_two_visitors_get_separate_databases_and_cannot_see_each_others_changes(): void
    {
        $this->asVisitor(str_repeat('a', 40))->post('/sign-in/google')->assertRedirect(route('home'));
        $firstSession = session()->getId();
        $firstSandbox = session(config('casefile.sandbox.session_key'));
        $firstPath = config('database.connections.sqlite.database');

        $this->asVisitor(str_repeat('b', 40))->post('/sign-in/google')->assertRedirect(route('home'));
        $secondSession = session()->getId();
        $secondSandbox = session(config('casefile.sandbox.session_key'));
        $secondPath = config('database.connections.sqlite.database');

        $this->assertNotSame($firstSession, $secondSession);
        $this->assertNotSame($firstSandbox, $secondSandbox);
        $this->assertNotSame($firstPath, $secondPath);
        $this->assertSame(config('casefile.sandbox.directory').DIRECTORY_SEPARATOR.$firstSandbox.'.sqlite', $firstPath);
        $this->assertSame(config('casefile.sandbox.directory').DIRECTORY_SEPARATOR.$secondSandbox.'.sqlite', $secondPath);

        $this->asVisitor($firstSession)->get('/')->assertOk();
        $this->assertAuthenticated();
        $this->assertSame($firstPath, DB::connection()->getDatabaseName());
        DB::table('users')->where('id', 1)->update(['name' => 'Dana Renamed']);

        $this->asVisitor($secondSession)->get('/')->assertOk();
        $this->assertSame($secondPath, DB::connection()->getDatabaseName());
        $this->assertSame('Dana Whitfield', DB::table('users')->where('id', 1)->value('name'));

        $this->asVisitor($firstSession)->get('/')->assertOk();
        $this->assertSame($firstPath, DB::connection()->getDatabaseName());
        $this->assertSame('Dana Renamed', DB::table('users')->where('id', 1)->value('name'));

        $this->assertSame('Dana Renamed', $this->ownerNameIn($firstPath));
        $this->assertSame('Dana Whitfield', $this->ownerNameIn($secondPath));
        $this->assertSame('Dana Whitfield', $this->ownerNameIn(config('casefile.sandbox.template')));
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_demo_sign_in_signs_the_owner_into_a_fresh_sandbox(): void
    {
        $this->post('/sign-in/google')->assertRedirect(route('home'));

        $id = session(config('casefile.sandbox.session_key'));
        $handle = app(SandboxStore::class)->resolve($id);

        $this->assertNotNull($handle);
        $this->assertSame($handle->path, DB::connection()->getDatabaseName());
        $this->assertAuthenticated();
        $this->assertSame('simulated-google-owner', DB::table('users')->where('id', 1)->value('google_subject'));
        $this->assertNull((new Sqlite('sqlite:'.config('casefile.sandbox.template')))->query('select google_subject from users where id = 1')->fetchColumn());
        $this->assertCount(1, File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
    }

    /**
     * @see bootstrap/app.php
     */
    public function test_the_sandbox_is_attached_before_authentication_looks_up_the_user(): void
    {
        $handle = app(SandboxStore::class)->provision('198.51.100.22');

        $this->assertSame(':memory:', DB::connection()->getDatabaseName());

        $this->withSession([Auth::guard()->getName() => 1, config('casefile.sandbox.session_key') => $handle->id])
            ->get('/')
            ->assertOk()
            ->assertDontSee('Your demo was reset.');

        $this->assertAuthenticated();
        $this->assertSame(1, Auth::id());
        $this->assertSame($handle->path, DB::connection()->getDatabaseName());
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_guest_without_a_session_gets_no_sandbox(): void
    {
        $this->get('/sign-in')->assertOk()->assertSee('Continue with Google (simulated)');
        $this->get('/')->assertRedirect('/sign-in');

        $this->assertDirectoryDoesNotExist(config('casefile.sandbox.directory'));
        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
        $this->assertFalse(session()->has('status'));
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_guest_holding_a_live_sandbox_id_is_attached_to_it_without_a_reset(): void
    {
        $handle = app(SandboxStore::class)->provision('198.51.100.20');

        $this->withSession([config('casefile.sandbox.session_key') => $handle->id])->get('/sign-in')->assertOk()->assertDontSee('Your demo was reset.');

        $this->assertSame($handle->path, DB::connection()->getDatabaseName());
        $this->assertCount(1, File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_a_guest_holding_a_dead_sandbox_id_gets_no_new_sandbox(): void
    {
        $stale = app(SandboxStore::class)->provision('198.51.100.23');
        (new Sqlite('sqlite:'.$stale->path))->exec("update installation_meta set schema_version = 'stale'");

        $this->withSession([config('casefile.sandbox.session_key') => $stale->id])->get('/sign-in')->assertOk()->assertDontSee('Your demo was reset.');
        $this->get('/sign-in')->assertOk();

        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
        $this->assertSame([$stale->path], File::glob(config('casefile.sandbox.directory').'/*.sqlite'));
        $this->assertSame($stale->id, session(config('casefile.sandbox.session_key')));
        $this->assertSame(1, RateLimiter::attempts('sandbox:198.51.100.23'));
        $this->assertSame(0, RateLimiter::attempts('sandbox:127.0.0.1'));
    }

    /**
     * @see App\Http\Middleware\UseSandboxDatabase
     */
    public function test_local_mode_ignores_sandboxes_entirely(): void
    {
        $handle = app(SandboxStore::class)->provision('198.51.100.21');
        config(['casefile.mode' => 'local']);

        $this->withSession([config('casefile.sandbox.session_key') => $handle->id])->get('/sign-in')->assertOk();

        $this->assertSame(':memory:', DB::connection()->getDatabaseName());
    }

    /**
     * @see App\Http\Controllers\SignInController::google()
     */
    public function test_local_sign_in_uses_the_configured_database_and_provisions_nothing(): void
    {
        config(['casefile.mode' => 'local']);
        $local = config('casefile.sandbox.directory').'-local.sqlite';
        File::copy(config('casefile.sandbox.template'), $local);
        $this->beforeApplicationDestroyed(fn () => File::delete($local));
        config(['database.connections.sqlite.database' => $local]);
        DB::purge('sqlite');

        $this->post('/sign-in/google')->assertRedirect(route('home'));

        $this->assertAuthenticated();
        $this->assertSame($local, DB::connection()->getDatabaseName());
        $this->assertFalse(session()->has(config('casefile.sandbox.session_key')));
        $this->assertDirectoryDoesNotExist(config('casefile.sandbox.directory'));
        $this->assertSame('simulated-google-owner', (new Sqlite('sqlite:'.$local))->query('select google_subject from users where id = 1')->fetchColumn());
    }
}
