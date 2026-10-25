<?php

namespace Tests\Feature;

use App\Enums\AccountRole;
use App\Enums\ProfileStatus;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Tests\Support\BuildsAccountRuntime;
use Tests\TestCase;

class AccountAccessTest extends TestCase
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
    public function test_admin_signup_and_extra_role_fields_are_rejected_without_accounts(): void
    {
        $form = $this->enterAccountDemo();
        $context = $this->formContext($form);
        $this->post('/register', ['_actor_context' => $context, 'name' => 'Fictional Admin', 'email' => 'new@account.example', 'role' => 'admin', 'password' => $this->accountPassword, 'password_confirmation' => $this->accountPassword])->assertStatus(422)->assertSee('Please check your details')->assertSee('new@account.example')->assertDontSee($this->accountPassword);
        $this->post('/demo/role', ['_actor_context' => $context, 'role' => 'stylist', 'user_id' => 3])->assertStatus(422);
        $this->post('/demo/role', ['_actor_context' => $context, 'role' => 3])->assertStatus(422);
        $this->admitAccountFixture();
        $this->assertDatabaseCount('users', 3, 'visitor');
        $this->assertDatabaseMissing('users', ['email' => 'new@account.example'], 'visitor');
        $this->assertNull(session()->getOldInput('password'));
    }

    /**
     * @return void
     */
    public function test_stylist_registration_normalizes_email_hashes_password_and_creates_one_draft(): void
    {
        $form = $this->enterAccountDemo();
        $token = session()->get('sandbox_token');
        $generation = session()->get('sandbox_generation');
        $oldRevision = session()->get('actor_revision');
        $oldToken = session()->token();
        $oldId = session()->getId();
        session()->put('untrusted_leftover', 'discard me');
        $this->post('/register', ['_actor_context' => $this->formContext($form), 'name' => 'New Stylist', 'email' => '  NEW@ACCOUNT.EXAMPLE  ', 'role' => 'stylist', 'password' => $this->accountPassword, 'password_confirmation' => $this->accountPassword])->assertRedirect('/stylist/setup');
        $this->assertNotSame($oldId, session()->getId());
        $this->assertNotSame($oldRevision, session()->get('actor_revision'));
        $this->assertNotSame($oldToken, session()->token());
        $this->assertSame($token, session()->get('sandbox_token'));
        $this->assertSame($generation, session()->get('sandbox_generation'));
        $this->assertFalse(session()->has('untrusted_leftover'));
        $this->assertDatabaseHas('revoked_sessions', ['digest' => hash('sha256', $oldId)], 'registry');
        $this->admitAccountFixture();
        $user = User::query()->where('email', 'new@account.example')->sole();
        $this->assertTrue(Hash::check($this->accountPassword, $user->password));
        $this->assertNotSame($this->accountPassword, $user->password);
        $this->assertTrue($user->hasRole(AccountRole::Stylist));
        $this->assertSame(ProfileStatus::Draft, $user->profile->status);
        $this->assertSame(25, $user->profile->deposit_percent);
        $this->assertSame(1, $user->profile()->count());
        $this->assertDatabaseCount('users', 4, 'visitor');
        $this->withCookie('strand_city_session', session()->getId());
        $this->get('/account')->assertOk()->assertSee('New Stylist');
    }

    /**
     * @return void
     */
    public function test_duplicate_normalized_email_is_rejected_and_values_are_escaped(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $this->post('/register', ['_actor_context' => $context, 'name' => '<script>name</script>', 'email' => ' CLIENT-01@STRAND-CITY.EXAMPLE ', 'role' => 'client', 'password' => $this->accountPassword, 'password_confirmation' => $this->accountPassword])->assertStatus(422)->assertSee('already registered')->assertSee('&lt;script&gt;name&lt;/script&gt;', false)->assertDontSee('<script>name</script>', false);
        $this->admitAccountFixture();
        $this->assertDatabaseCount('users', 3, 'visitor');
    }

    /**
     * @return void
     */
    public function test_logout_preserves_sandbox_and_anonymous_login_rotates_identity(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $sandbox = session()->get('sandbox_token');
        $this->post('/logout', ['_actor_context' => $context])->assertRedirect('/login');
        $this->assertSame($sandbox, session()->get('sandbox_token'));
        $this->withCookie('strand_city_session', session()->getId());
        $form = $this->get('/login')->assertOk();
        $this->get('/account')->assertRedirect('/login');
        $anonymousRevision = session()->get('actor_revision');
        $this->post('/login', ['_actor_context' => $this->formContext($form), 'email' => 'CLIENT-01@STRAND-CITY.EXAMPLE', 'password' => $this->accountPassword])->assertRedirect('/demo/ready');
        $this->assertNotSame($anonymousRevision, session()->get('actor_revision'));
        $this->withCookie('strand_city_session', session()->getId());
        $this->get('/account')->assertOk()->assertSee('Client Fictional');
    }

    /**
     * @return void
     */
    public function test_failed_credentials_share_one_message_and_login_is_rate_limited(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        foreach (['missing@account.example', config('demo.seed_accounts.client')] as $email) {
            $this->post('/login', ['_actor_context' => $context, 'email' => $email, 'password' => 'incorrect-password'])->assertStatus(422)->assertSee('The email or password is incorrect.')->assertDontSee('incorrect-password');
        }
        for ($attempt = 0; $attempt < 4; $attempt++) {
            $this->post('/login', ['_actor_context' => $context, 'email' => config('demo.seed_accounts.client'), 'password' => 'incorrect-password'])->assertStatus(422);
        }
        $this->post('/login', ['_actor_context' => $context, 'email' => config('demo.seed_accounts.client'), 'password' => $this->accountPassword])->assertStatus(429);
        $this->assertNull(session()->getOldInput('password'));
    }

    /**
     * @return void
     */
    public function test_wrong_role_access_is_forbidden_and_get_cannot_mutate(): void
    {
        Route::middleware(['web', 'sandbox', 'actor', 'auth', 'role:stylist'])->get('/only-stylist', fn () => response('unsafe'));
        $this->enterAccountDemo();
        $this->get('/only-stylist')->assertForbidden();
        $this->get('/demo/role?role=admin')->assertStatus(405);
        $this->get('/logout')->assertStatus(405);
        $this->admitAccountFixture();
        $this->assertDatabaseHas('users', ['email' => config('demo.seed_accounts.client'), 'role' => 'client'], 'visitor');
    }

    /**
     * @return void
     */
    public function test_tombstone_capacity_rejects_switch_before_identity_or_revision_changes(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $originalId = session()->getId();
        $originalRevision = session()->get('actor_revision');
        $existing = DB::connection('registry')->table('revoked_sessions')->count();
        for ($index = $existing; $index < 1000; $index++) {
            DB::connection('registry')->table('revoked_sessions')->insert(['digest' => hash('sha256', 'capacity-'.$index), 'expires_at' => CarbonImmutable::now()->addMinute()]);
        }
        $this->post('/demo/role', ['_actor_context' => $context, 'role' => 'stylist'])->assertStatus(429);
        $this->assertSame($originalId, session()->getId());
        $this->assertSame($originalRevision, session()->get('actor_revision'));
        $this->get('/account')->assertOk()->assertSee('Client Fictional');
    }

    /**
     * @return void
     */
    public function test_registration_profile_capacity_rolls_back_the_account(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $this->admitAccountFixture();
        for ($index = 1; $index < 20; $index++) {
            $user = User::query()->create(['name' => 'Capacity Stylist', 'email' => 'capacity-'.$index.'@account.example', 'password' => $this->accountPassword, 'role' => AccountRole::Stylist]);
            $user->profile()->create(['city_code' => 'paris', 'timezone' => 'Europe/Paris', 'status' => ProfileStatus::Draft]);
        }
        $this->post('/register', ['_actor_context' => $context, 'name' => 'Overflow Stylist', 'email' => 'overflow@account.example', 'role' => 'stylist', 'password' => $this->accountPassword, 'password_confirmation' => $this->accountPassword])->assertStatus(429);
        $this->admitAccountFixture();
        $this->assertDatabaseCount('users', 22, 'visitor');
        $this->assertDatabaseMissing('users', ['email' => 'overflow@account.example'], 'visitor');
    }

    /**
     * @return void
     */
    public function test_name_update_and_invalid_json_follow_http_conventions(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $this->patch('/account', ['_actor_context' => $context, 'name' => 'A New Name'])->assertRedirect('/account');
        $this->get('/account')->assertOk()->assertSee('A New Name')->assertSee('Your name has been saved.');
        $this->patch('/account', ['_actor_context' => $context, 'name' => str_repeat('n', 81)])->assertStatus(422)->assertSee('Please check your details');
        $this->patch('/account', ['_actor_context' => $context, 'name' => '   '])->assertStatus(422)->assertSee('name="name" maxlength="80" required autocomplete="name" value=""', false);
        $this->withCredentials()->patchJson('/account', ['_actor_context' => $context, 'name' => ''])->assertStatus(422)->assertJsonValidationErrors('name');
    }

    /**
     * @return void
     */
    public function test_registration_user_capacity_rejects_without_rotating_identity(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $originalId = session()->getId();
        $this->admitAccountFixture();
        $passwordHash = User::query()->firstOrFail()->password;
        for ($index = 3; $index < 40; $index++) {
            User::query()->create(['name' => 'Capacity Client', 'email' => 'capacity-'.$index.'@account.example', 'password' => $passwordHash, 'role' => AccountRole::Client]);
        }
        $this->post('/register', ['_actor_context' => $context, 'name' => 'Overflow Client', 'email' => 'overflow@account.example', 'role' => 'client', 'password' => $this->accountPassword, 'password_confirmation' => $this->accountPassword])->assertStatus(429);
        $this->assertSame($originalId, session()->getId());
        $this->admitAccountFixture();
        $this->assertDatabaseCount('users', 40, 'visitor');
        $this->assertDatabaseMissing('users', ['email' => 'overflow@account.example'], 'visitor');
    }

    /**
     * @return void
     */
    public function test_password_bounds_and_signup_rate_limit_are_enforced(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        foreach ([11, 129, 11, 129, 11] as $length) {
            $password = str_repeat('p', $length);
            $this->post('/register', ['_actor_context' => $context, 'name' => 'Bounded Client', 'email' => 'bounds@account.example', 'role' => 'client', 'password' => $password, 'password_confirmation' => $password])->assertStatus(422);
        }
        $this->post('/register', ['_actor_context' => $context, 'name' => 'Bounded Client', 'email' => 'bounds@account.example', 'role' => 'client', 'password' => $this->accountPassword, 'password_confirmation' => $this->accountPassword])->assertStatus(429);
        $this->admitAccountFixture();
        $this->assertDatabaseCount('users', 3, 'visitor');
    }

    /**
     * @return void
     */
    public function test_role_switch_limit_survives_session_rotation(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->post('/demo/role', ['_actor_context' => $context, 'role' => $attempt % 2 === 0 ? 'stylist' : 'client'])->assertRedirect('/workspace');
            $this->withCookie('strand_city_session', session()->getId());
            $context = $this->formContext($this->get('/account')->assertOk());
        }
        $this->post('/demo/role', ['_actor_context' => $context, 'role' => 'admin'])->assertStatus(429);
        $this->get('/account')->assertOk()->assertSee('Client Fictional');
    }

    /**
     * @return void
     */
    public function test_password_suffixes_and_full_128_character_credentials_authenticate_exactly(): void
    {
        $this->assertSame('argon2id', config('hashing.driver'));
        $this->assertSame('argon2id', Hash::info(config('demo.auth.dummy_password_hash'))['algoName']);
        $form = $this->enterAccountDemo();
        foreach ([str_repeat('a', 72).'suffix', str_repeat('é', 40).'suffix', str_repeat('b', 127).'A', str_repeat('é', 127).'A'] as $index => $password) {
            $email = 'full-password-'.$index.'@account.example';
            $this->post('/register', ['_actor_context' => $this->formContext($form), 'name' => 'Full Password Client', 'email' => $email, 'role' => 'client', 'password' => $password, 'password_confirmation' => $password])->assertRedirect('/demo/ready');
            $this->withCookie('strand_city_session', session()->getId());
            $form = $this->get('/account')->assertOk();
            $this->admitAccountFixture();
            $storedHash = User::query()->where('email', $email)->sole()->password;
            $this->assertSame('argon2id', Hash::info($storedHash)['algoName']);
            $this->assertTrue(Hash::check($password, $storedHash));
            $this->post('/logout', ['_actor_context' => $this->formContext($form)])->assertRedirect('/login');
            $this->withCookie('strand_city_session', session()->getId());
            $context = $this->formContext($this->get('/login')->assertOk());
            $differentSuffix = mb_substr($password, 0, mb_strlen($password) - 1).'B';
            $this->post('/login', ['_actor_context' => $context, 'email' => $email, 'password' => $differentSuffix])->assertStatus(422)->assertSee('The email or password is incorrect.');
            $this->post('/login', ['_actor_context' => $context, 'email' => $email, 'password' => $password])->assertRedirect('/demo/ready');
            $this->withCookie('strand_city_session', session()->getId());
            $form = $this->get('/account')->assertOk();
        }
    }

    /**
     * @return void
     */
    public function test_hash_looking_passwords_are_literal_credentials(): void
    {
        $form = $this->enterAccountDemo();
        $representedPlaintext = 'represented-password-123';
        foreach ([password_hash($representedPlaintext, PASSWORD_BCRYPT, ['cost' => 4]), Hash::make($representedPlaintext)] as $index => $literalPassword) {
            $email = 'literal-password-'.$index.'@account.example';
            $this->post('/register', ['_actor_context' => $this->formContext($form), 'name' => 'Literal Password Client', 'email' => $email, 'role' => 'client', 'password' => $literalPassword, 'password_confirmation' => $literalPassword])->assertRedirect('/demo/ready');
            $this->withCookie('strand_city_session', session()->getId());
            $form = $this->get('/account')->assertOk();
            $this->admitAccountFixture();
            $storedHash = User::query()->where('email', $email)->sole()->password;
            $this->assertNotSame($literalPassword, $storedHash);
            $this->assertTrue(Hash::check($literalPassword, $storedHash));
            $this->assertFalse(Hash::check($representedPlaintext, $storedHash));
            $this->post('/logout', ['_actor_context' => $this->formContext($form)])->assertRedirect('/login');
            $this->withCookie('strand_city_session', session()->getId());
            $context = $this->formContext($this->get('/login')->assertOk());
            $this->post('/login', ['_actor_context' => $context, 'email' => $email, 'password' => $representedPlaintext])->assertStatus(422)->assertSee('The email or password is incorrect.');
            $this->post('/login', ['_actor_context' => $context, 'email' => $email, 'password' => $literalPassword])->assertRedirect('/demo/ready');
            $this->withCookie('strand_city_session', session()->getId());
            $form = $this->get('/account')->assertOk();
        }
    }

    /**
     * @return void
     */
    public function test_legacy_bcrypt_credentials_fail_neutrally_without_runtime_rewrites(): void
    {
        $context = $this->formContext($this->enterAccountDemo());
        $sessionId = session()->getId();
        $this->admitAccountFixture();
        $legacyHash = password_hash($this->accountPassword, PASSWORD_BCRYPT, ['cost' => 4]);
        DB::connection('visitor')->table('users')->where('email', config('demo.seed_accounts.client'))->update(['password' => $legacyHash]);
        $this->post('/login', ['_actor_context' => $context, 'email' => config('demo.seed_accounts.client'), 'password' => $this->accountPassword])->assertStatus(422)->assertSee('The email or password is incorrect.');
        $this->assertSame($sessionId, session()->getId());
        $this->admitAccountFixture();
        $this->assertSame($legacyHash, User::query()->where('email', config('demo.seed_accounts.client'))->sole()->password);
        $this->post('/demo/role', ['_actor_context' => $context, 'role' => 'stylist'])->assertRedirect('/workspace');
        $this->withCookie('strand_city_session', session()->getId());
        $this->get('/account')->assertOk()->assertSee('Stylist Fictional');
    }
}
