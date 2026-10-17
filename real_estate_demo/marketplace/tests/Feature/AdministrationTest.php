<?php

namespace Tests\Feature;

use App\Actions\Admin\ChangeProviderStatus;
use App\Actions\Admin\SaveCategory;
use App\Enums\ProviderStatus;
use App\Models\Category;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class AdministrationTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_non_admins_cannot_use_any_admin_route(): void
    {
        $category = Category::factory()->create();
        $provider = $this->provider($category);
        foreach ([$this->customer(), $provider] as $actor) {
            $this->actingAs($actor);
            foreach (['/admin', '/admin/providers', '/admin/categories', '/admin/jobs'] as $path) {
                $this->get($path)->assertForbidden();
            }
            $this->post('/admin/categories', ['name' => 'Roofing'])->assertForbidden();
            $this->patch("/admin/categories/{$category->id}", [])->assertForbidden();
            $this->patch("/admin/providers/{$provider->profile->id}/status", ['status' => 'suspended'])->assertForbidden();
        }
    }

    public function test_provider_approval_suspension_and_restoration_notify_once(): void
    {
        $provider = $this->provider(Category::factory()->create(), status: 'pending');
        $this->actingAs(User::factory()->admin()->create());
        foreach (['approved', 'suspended', 'approved'] as $target) {
            $this->patch("/admin/providers/{$provider->profile->id}/status", ['status' => $target])->assertRedirect();
            self::assertSame($target, $provider->profile->fresh()->status->value);
        }
        $this->patch("/admin/providers/{$provider->profile->id}/status", ['status' => 'approved'])->assertRedirect();
        self::assertSame(3, $provider->notifications()->count());
        $this->patchJson("/admin/providers/{$provider->profile->id}/status", ['status' => 'pending'])->assertStatus(409);
        $this->patchJson("/admin/providers/{$provider->profile->id}/status", ['status' => 'unknown'])->assertUnprocessable();
    }

    public function test_demo_identities_cannot_be_changed(): void
    {
        $provider = $this->provider(Category::factory()->create());
        $provider->forceFill(['demo_key' => 'provider'])->save();
        $this->actingAs(User::factory()->admin()->create())
            ->patchJson("/admin/providers/{$provider->profile->id}/status", ['status' => 'suspended'])->assertStatus(409);
        self::assertSame('approved', $provider->profile->fresh()->status->value);
        self::assertSame(0, $provider->notifications()->count());
    }

    public function test_incomplete_profiles_cannot_be_approved(): void
    {
        $this->actingAs(User::factory()->admin()->create());
        foreach (['business_name' => ' ', 'bio' => '', 'service_areas' => ['Not a service area']] as $field => $value) {
            $provider = $this->provider(Category::factory()->create(), status: 'pending');
            $provider->profile->update([$field => $value]);
            $this->patchJson("/admin/providers/{$provider->profile->id}/status", ['status' => 'approved'])->assertStatus(409);
        }
        $provider = $this->provider(Category::factory()->create(['is_active' => false]), status: 'pending');
        $this->patchJson("/admin/providers/{$provider->profile->id}/status", ['status' => 'approved'])->assertStatus(409);
    }

    public function test_suspension_blocks_new_work_but_preserves_historical_conversation_reads(): void
    {
        $category = Category::factory()->create();
        $provider = $this->provider($category);
        $job = $this->job($this->customer(), $category, ['status' => 'booked']);
        $quote = $this->quote($job, $provider, ['status' => 'accepted']);
        $job->update(['accepted_quote_id' => $quote->id]);
        $open = $this->job($this->customer(), $category);
        $this->actingAs(User::factory()->admin()->create())
            ->patch("/admin/providers/{$provider->profile->id}/status", ['status' => 'suspended'])->assertRedirect();
        $this->actingAs($provider->fresh())->get("/conversations/{$quote->id}")->assertOk();
        $this->post("/requests/{$job->id}/status", ['status' => 'in_progress'])->assertForbidden();
        $this->post("/conversations/{$quote->id}/messages", ['body' => 'Hidden write'])->assertForbidden();
        $this->post("/requests/{$open->id}/quotes", ['amount' => '50.00', 'available_date' => now()->addWeek()->toDateString(), 'scope' => 'Work'])->assertForbidden();
    }

    public function test_categories_keep_slug_and_history_when_renamed_or_deactivated(): void
    {
        $category = Category::factory()->create(['slug' => 'original']);
        $job = $this->job($this->customer(), $category);
        $this->actingAs(User::factory()->admin()->create())->patch("/admin/categories/{$category->id}", [
            'name' => 'Renamed service', 'description' => 'Careful repairs.', 'icon' => 'pipe', 'is_active' => false,
        ])->assertRedirect();
        self::assertFalse($category->fresh()->is_active);
        self::assertSame('original', $category->fresh()->slug);
        $this->assertDatabaseHas('service_requests', ['id' => $job->id, 'category_id' => $category->id]);
        $this->get("/requests/{$job->id}")->assertOk();
        $this->get('/services')->assertDontSee('Renamed service');
    }

    public function test_category_creation_validates_slug_collision_icon_and_lengths(): void
    {
        $this->actingAs(User::factory()->admin()->create());
        $valid = ['name' => 'Home Care', 'description' => 'Thoughtful service.', 'icon' => 'sparkles', 'is_active' => true];
        $this->post('/admin/categories', $valid)->assertRedirect();
        self::assertSame('home-care', Category::sole()->slug);
        $this->postJson('/admin/categories', $valid)->assertUnprocessable()->assertJsonValidationErrors('name');
        foreach ([['icon' => '<script>'], ['name' => str_repeat('x', 81)], ['description' => str_repeat('x', 501)], ['is_active' => 'maybe'], ['name' => '!!!']] as $invalid) {
            $this->postJson('/admin/categories', array_merge($valid, $invalid))->assertUnprocessable();
        }
        self::assertSame(1, Category::count());
    }

    public function test_status_action_rechecks_admin_role(): void
    {
        $provider = $this->provider(Category::factory()->create());
        $this->expectException(AuthorizationException::class);
        app(ChangeProviderStatus::class)->handle($this->customer(), $provider->profile, ProviderStatus::Suspended);
    }

    public function test_category_action_rechecks_admin_role(): void
    {
        $this->expectException(AuthorizationException::class);
        app(SaveCategory::class)->handle($this->customer(), ['name' => 'Roofing']);
    }
}
