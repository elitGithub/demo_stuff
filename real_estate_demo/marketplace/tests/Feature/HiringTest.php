<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class HiringTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_acceptance_selects_one_quote_and_retries_are_idempotent(): void
    {
        $category = Category::factory()->create();
        $customer = $this->customer();
        $job = $this->job($customer, $category);
        $first = $this->quote($job, $this->provider($category));
        $second = $this->quote($job, $this->provider($category));

        $this->actingAs($customer)->post("/quotes/{$first->id}/accept", ['version' => 1])->assertRedirect();
        $notifications = User::find($first->provider_id)->notifications()->count();
        $this->post("/quotes/{$second->id}/accept", ['version' => 1])->assertConflict();
        $this->post("/quotes/{$first->id}/accept", ['version' => 1])->assertRedirect();

        self::assertSame($first->id, $job->fresh()->accepted_quote_id);
        self::assertSame('booked', $job->fresh()->status->value);
        self::assertSame('declined', $second->fresh()->status->value);
        self::assertSame(1, $job->events()->where('type', 'booked')->count());
        self::assertSame($notifications, User::find($first->provider_id)->notifications()->count());
        self::assertGreaterThan(0, $notifications);
    }

    public function test_an_old_comparison_cannot_accept_a_revised_price(): void
    {
        $category = Category::factory()->create();
        $customer = $this->customer();
        $job = $this->job($customer, $category);
        $quote = $this->quote($job, $this->provider($category), ['version' => 2]);

        $this->actingAs($customer)->postJson("/quotes/{$quote->id}/accept", ['version' => 1])->assertConflict();

        self::assertNull($job->fresh()->accepted_quote_id);
        $this->assertDatabaseCount('job_events', 0);
        $this->assertDatabaseCount('notifications', 0);
    }

    public function test_only_the_request_customer_can_hire(): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $provider = $this->provider($category);
        $quote = $this->quote($job, $provider);

        $this->actingAs($this->customer())->postJson("/quotes/{$quote->id}/accept", ['version' => 1])->assertForbidden();
        $this->actingAs($provider)->postJson("/quotes/{$quote->id}/accept", ['version' => 1])->assertForbidden();
        self::assertNull($job->fresh()->accepted_quote_id);
    }

    public function test_an_unavailable_provider_cannot_be_hired(): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category);
        $provider = $this->provider($category);
        $quote = $this->quote($job, $provider);
        $provider->profile->update(['status' => 'suspended']);

        $this->actingAs($owner)->postJson("/quotes/{$quote->id}/accept", ['version' => 1])->assertConflict();
        self::assertNull($job->fresh()->accepted_quote_id);
    }

    public function test_a_provider_who_changed_service_area_cannot_be_hired_from_an_old_quote(): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category);
        $provider = $this->provider($category);
        $quote = $this->quote($job, $provider);
        $provider->profile->update(['service_areas' => ['Cedar Park']]);

        $this->actingAs($owner)->postJson("/quotes/{$quote->id}/accept", ['version' => 1])->assertConflict();
        self::assertNull($job->fresh()->accepted_quote_id);
    }

    public function test_only_the_hired_provider_sees_private_details_and_never_competitor_quotes(): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category);
        $provider = $this->provider($category);
        $quote = $this->quote($job, $provider);
        $rival = $this->provider($category);
        $this->quote($job, $rival, ['scope' => 'Private competitor scope']);

        $this->actingAs($owner)->post("/quotes/{$quote->id}/accept", ['version' => 1])->assertRedirect();

        $this->actingAs($provider)->get("/requests/{$job->id}")->assertOk()->assertSee('1842 Juniper Lane')
            ->assertDontSee('Private competitor scope');
        $this->actingAs($rival)->get("/requests/{$job->id}")->assertOk()->assertDontSee('1842 Juniper Lane');
    }
}
