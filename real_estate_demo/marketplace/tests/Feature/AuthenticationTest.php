<?php

namespace Tests\Feature;

use App\Enums\ProviderStatus;
use App\Enums\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    private function registration(array $overrides = []): array
    {
        return array_replace([
            'name' => 'Alex Sample', 'email' => 'alex@example.test',
            'password' => 'demo-password-123', 'password_confirmation' => 'demo-password-123',
            'account_type' => 'customer',
        ], $overrides);
    }

    public function test_registration_cannot_choose_admin_privileges(): void
    {
        $this->postJson('/register', $this->registration(['account_type' => 'admin', 'role' => 'admin']))
            ->assertUnprocessable()->assertJsonValidationErrors(['account_type', 'role']);
        $this->assertDatabaseMissing('users', ['email' => 'alex@example.test']);
    }

    public function test_customer_registration_hashes_password_and_normalizes_email(): void
    {
        $this->post('/register', $this->registration(['email' => 'ALEX@example.test']))
            ->assertRedirect('/dashboard');

        $user = User::where('email', 'alex@example.test')->sole();
        self::assertTrue(Hash::check('demo-password-123', $user->password));
        self::assertSame(Role::Customer, $user->role);
        $this->assertAuthenticatedAs($user);
    }

    public function test_provider_registration_creates_a_pending_profile(): void
    {
        $this->post('/register', $this->registration(['account_type' => 'provider']))
            ->assertRedirect('/dashboard');

        $user = User::where('email', 'alex@example.test')->sole();
        self::assertSame(Role::Provider, $user->role);
        self::assertSame(ProviderStatus::Pending, $user->profile->status);
        $this->assertDatabaseCount('provider_profiles', 1);
    }

    public function test_duplicate_email_registration_is_rejected(): void
    {
        User::factory()->create(['email' => 'alex@example.test']);

        $this->postJson('/register', $this->registration(['email' => 'ALEX@example.test']))
            ->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertDatabaseCount('users', 1);
    }

    public function test_login_regenerates_session_and_logout_ends_it(): void
    {
        $user = User::factory()->create();
        $this->get('/login')->assertOk();
        $oldId = session()->getId();

        $this->post('/login', ['email' => $user->email, 'password' => 'password'])
            ->assertRedirect('/dashboard');

        $this->assertAuthenticatedAs($user);
        self::assertNotSame($oldId, session()->getId());

        $this->post('/logout')->assertRedirect('/');
        $this->assertGuest();
    }

    public function test_sixth_failed_login_is_throttled(): void
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/login', ['email' => 'missing@example.test', 'password' => 'wrong'])
                ->assertUnprocessable();
        }

        $this->postJson('/login', ['email' => 'missing@example.test', 'password' => 'wrong'])
            ->assertTooManyRequests();
        $this->assertGuest();
    }

    public function test_private_dashboard_requires_login(): void
    {
        $this->get('/dashboard')->assertRedirect('/login');
    }

    public function test_registration_form_renders(): void
    {
        $this->get('/register')->assertOk()->assertSee('Create your account');
    }
}
