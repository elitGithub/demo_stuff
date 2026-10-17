<?php

namespace Tests\Feature;

use App\Models\Category;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class OpportunityTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_opportunities_match_category_area_and_open_status(): void
    {
        $category = Category::factory()->create();
        $provider = $this->provider($category);
        $customer = $this->customer();
        $this->job($customer, $category, ['title' => 'Matching opportunity']);
        $this->job($customer, $category, ['title' => 'Wrong area', 'service_area' => 'Cedar Park']);
        $this->job($customer, Category::factory()->create(), ['title' => 'Wrong service']);
        $this->job($customer, $category, ['title' => 'Closed opportunity', 'status' => 'completed']);

        $this->actingAs($provider)->get('/opportunities')->assertOk()->assertSee('Matching opportunity')
            ->assertDontSee('Wrong area')->assertDontSee('Wrong service')->assertDontSee('Closed opportunity');
    }

    public function test_pending_provider_cannot_browse_opportunities(): void
    {
        $provider = $this->provider(Category::factory()->create(), status: 'pending');

        $this->actingAs($provider)->get('/opportunities')->assertForbidden();
    }

    public function test_historical_provider_can_read_their_request_after_suspension_without_the_address(): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category, ['status' => 'completed']);
        $provider = $this->provider($category, status: 'suspended');
        $this->quote($job, $provider, ['status' => 'declined']);

        $this->actingAs($provider)->get("/requests/{$job->id}")
            ->assertOk()->assertDontSee('1842 Juniper Lane');
    }
}
