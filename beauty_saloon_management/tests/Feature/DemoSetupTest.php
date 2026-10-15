<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Opportunity;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DemoSetupTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_setup_refuses_to_change_a_non_demo_database(): void
    {
        config(['studio.demo' => false]);
        $this->artisan('studio:prepare-demo')->assertFailed();
        $this->assertDatabaseCount('users', 0);
    }

    public function test_repeated_demo_setup_preserves_existing_edits(): void
    {
        config(['studio.demo' => true]);
        $this->artisan('studio:prepare-demo')->assertSuccessful();
        $this->assertGreaterThan(0, Product::count());
        $this->assertGreaterThan(0, Opportunity::count());
        $clientCount = Client::count();
        $userCount = User::count();
        $client = Client::firstOrFail();
        $client->update(['name' => 'Keep this edit']);
        $this->artisan('studio:prepare-demo')->assertSuccessful();
        $this->assertDatabaseCount('clients', $clientCount);
        $this->assertDatabaseCount('users', $userCount);
        $this->assertSame('Keep this edit', $client->fresh()->name);
    }
}
