<?php

namespace Tests\Feature;

use App\Models\Category;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class DiscoveryTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_public_directory_shows_only_approved_professionals_and_matching_filters(): void
    {
        $category = Category::factory()->create();
        $approved = $this->provider($category);
        $pending = $this->provider($category, status: 'pending');
        $suspended = $this->provider($category, status: 'suspended');
        $away = $this->provider($category, 'Cedar Park');

        $this->get('/professionals?area=Austin&category='.$category->id)
            ->assertOk()->assertSee($approved->profile->business_name)
            ->assertDontSee($pending->profile->business_name)
            ->assertDontSee($suspended->profile->business_name)
            ->assertDontSee($away->profile->business_name);
        $this->get('/professionals/'.$pending->profile->slug)->assertNotFound();
    }

    public function test_home_and_categories_show_active_services(): void
    {
        Category::factory()->create(['name' => 'Garden care']);
        Category::factory()->create(['name' => 'Hidden service', 'is_active' => false]);

        $this->get('/')->assertOk()->assertSee('Garden care')->assertDontSee('Hidden service');
        $this->get('/services')->assertOk()->assertSee('Garden care')->assertDontSee('Hidden service');
    }

    public function test_professional_search_matches_business_name(): void
    {
        $category = Category::factory()->create();
        $provider = $this->provider($category);
        $provider->profile->update(['business_name' => 'Juniper Home Care']);

        $this->get('/professionals?q=Juniper')->assertOk()->assertSee('Juniper Home Care');
        $this->get('/professionals?q=Unrelated')->assertOk()->assertDontSee('Juniper Home Care');
    }
}
