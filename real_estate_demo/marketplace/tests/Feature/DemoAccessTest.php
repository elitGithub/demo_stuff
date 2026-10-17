<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DemoAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_entry_is_disabled_by_default(): void
    {
        $this->post('/demo/admin')->assertNotFound();
        $this->assertGuest();
    }

    public function test_demo_entry_rejects_arbitrary_ids(): void
    {
        config(['demo.enabled' => true]);

        $this->post('/demo/123')->assertNotFound();
        $this->assertGuest();
    }

    public function test_demo_entry_selects_only_the_allowlisted_identity_and_rotates_session(): void
    {
        config(['demo.enabled' => true]);
        $demo = User::factory()->customer()->create(['demo_key' => 'customer']);
        $other = User::factory()->admin()->create();
        $this->get('/login')->assertOk();
        $oldId = session()->getId();

        $this->post('/demo/customer', ['user_id' => $other->id])->assertRedirect('/dashboard');

        $this->assertAuthenticatedAs($demo);
        self::assertNotSame($oldId, session()->getId());
    }

    public function test_demo_entry_is_unavailable_in_production_even_with_the_flag(): void
    {
        config(['demo.enabled' => true]);
        $this->app->instance('env', 'production');
        $token = 'production-form-csrf-token';

        $this->withSession(['_token' => $token])
            ->post('/demo/admin', ['_token' => $token])->assertNotFound();
        $this->assertGuest();
    }

    public function test_demo_entry_rejects_a_mismatched_identity_role(): void
    {
        config(['demo.enabled' => true]);
        User::factory()->admin()->create(['demo_key' => 'customer']);

        $this->post('/demo/customer')->assertNotFound();
        $this->assertGuest();
    }
}
