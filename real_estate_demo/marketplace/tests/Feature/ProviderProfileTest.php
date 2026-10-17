<?php

namespace Tests\Feature;

use App\Enums\ProviderStatus;
use App\Models\Category;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class ProviderProfileTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    private function details(Category $category, array $overrides = []): array
    {
        return array_replace([
            'business_name' => 'Juniper Plumbing', 'bio' => 'Residential repairs.',
            'category_ids' => [$category->id], 'service_areas' => ['Austin'],
        ], $overrides);
    }

    public function test_provider_cannot_approve_their_own_profile(): void
    {
        $category = Category::factory()->create();
        $provider = $this->provider($category, status: 'pending');

        $this->actingAs($provider)->putJson('/professional/profile',
            $this->details($category, ['status' => 'approved']))
            ->assertUnprocessable()->assertJsonValidationErrors('status');

        self::assertSame(ProviderStatus::Pending, $provider->profile->fresh()->status);
    }

    public function test_provider_can_update_services_without_losing_approval_or_slug(): void
    {
        $category = Category::factory()->create();
        $newCategory = Category::factory()->create();
        $provider = $this->provider($category);
        $slug = $provider->profile->slug;

        $this->actingAs($provider)->put('/professional/profile',
            $this->details($newCategory, ['service_areas' => ['Cedar Park']]))
            ->assertRedirect('/professional/profile');

        $profile = $provider->profile->fresh();
        self::assertSame('Juniper Plumbing', $profile->business_name);
        self::assertSame(ProviderStatus::Approved, $profile->status);
        self::assertSame($slug, $profile->slug);
        self::assertSame(['Cedar Park'], $profile->service_areas);
        self::assertSame([$newCategory->id], $profile->categories->modelKeys());
    }

    public function test_customer_cannot_edit_a_professional_profile(): void
    {
        $category = Category::factory()->create();

        $this->actingAs($this->customer())->putJson('/professional/profile', $this->details($category))
            ->assertForbidden();
        $this->assertDatabaseCount('provider_profiles', 0);
    }

    public function test_profile_rejects_inactive_categories_and_unknown_areas(): void
    {
        $category = Category::factory()->create(['is_active' => false]);
        $provider = $this->provider($category);

        $this->actingAs($provider)->putJson('/professional/profile',
            $this->details($category, ['service_areas' => ['Anywhere']]))
            ->assertUnprocessable()->assertJsonValidationErrors(['category_ids.0', 'service_areas.0']);
    }

    public function test_profile_form_shows_saved_values(): void
    {
        $provider = $this->provider(Category::factory()->create());

        $this->actingAs($provider)->get('/professional/profile')
            ->assertOk()->assertSee($provider->profile->business_name);
    }
}
