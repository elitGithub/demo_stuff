<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class JobLifecycleTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    private function agreement(string $status = 'booked'): array
    {
        $category = Category::factory()->create();
        $customer = $this->customer();
        $provider = $this->provider($category);
        $job = $this->job($customer, $category, ['status' => $status]);
        $quote = $this->quote($job, $provider, ['status' => 'accepted']);
        $job->update(['accepted_quote_id' => $quote->id]);

        return [$customer, $provider, $job];
    }

    public function test_hired_provider_and_customer_complete_the_job_in_order(): void
    {
        [$customer, $provider, $job] = $this->agreement('open');
        $job->update(['accepted_quote_id' => null]);
        $quote = $job->quotes()->sole();
        $quote->update(['status' => 'pending']);
        $this->actingAs($customer)->post("/quotes/{$quote->id}/accept", ['version' => 1])->assertRedirect();
        $this->actingAs($provider)->post("/requests/{$job->id}/status", ['status' => 'completed'])->assertStatus(409);
        foreach (['in_progress', 'awaiting_confirmation'] as $status) {
            $this->post("/requests/{$job->id}/status", ['status' => $status])->assertRedirect();
        }
        $this->actingAs($customer)->post("/requests/{$job->id}/status", ['status' => 'completed'])->assertRedirect();
        self::assertSame('completed', $job->fresh()->status->value);
        self::assertSame(4, $job->events()->count());
        self::assertSame(2, $customer->notifications()->count());
        self::assertSame(2, $provider->notifications()->count());
    }

    public function test_only_participants_can_change_status_and_suspended_provider_cannot_write(): void
    {
        [$customer, $provider, $job] = $this->agreement();
        foreach ([$this->customer(), $this->provider($job->category), User::factory()->admin()->create()] as $stranger) {
            $this->actingAs($stranger)->post("/requests/{$job->id}/status", ['status' => 'in_progress'])->assertForbidden();
        }
        $this->actingAs($customer)->post("/requests/{$job->id}/status", ['status' => 'in_progress'])->assertStatus(409);
        $provider->profile->update(['status' => 'suspended']);
        $this->actingAs($provider)->post("/requests/{$job->id}/status", ['status' => 'in_progress'])->assertForbidden();
        self::assertSame('booked', $job->fresh()->status->value);
        self::assertSame(0, $job->events()->count());
    }

    public function test_duplicate_transition_has_no_duplicate_side_effects_and_invalid_value_is_rejected(): void
    {
        [$customer, $provider, $job] = $this->agreement();
        $this->actingAs($provider)->postJson("/requests/{$job->id}/status", ['status' => 'magic'])->assertUnprocessable();
        for ($i = 0; $i < 2; $i++) {
            $this->post("/requests/{$job->id}/status", ['status' => 'in_progress'])->assertRedirect();
        }
        self::assertSame(1, $job->events()->count());
        self::assertSame(1, $customer->notifications()->count());
    }

    public function test_open_and_booked_jobs_can_be_cancelled_once_with_history_preserved(): void
    {
        foreach (['open', 'booked'] as $status) {
            [$customer, $provider, $job] = $this->agreement($status);
            $quote = $job->quotes()->sole();
            if ($status === 'open') {
                $quote->update(['status' => 'pending']);
                $job->update(['accepted_quote_id' => null]);
            }
            $before = $provider->notifications()->count();
            for ($i = 0; $i < 2; $i++) {
                $this->actingAs($customer)->post("/requests/{$job->id}/cancel")->assertRedirect();
            }
            self::assertSame('cancelled', $job->fresh()->status->value);
            self::assertSame($status === 'open' ? 'declined' : 'accepted', $quote->fresh()->status->value);
            self::assertSame(1, $job->events()->count());
            self::assertSame($before + 1, $provider->notifications()->count());
        }
    }

    public function test_cancellation_requires_owner_and_stops_when_work_starts(): void
    {
        [$customer, $provider, $job] = $this->agreement('in_progress');
        $this->actingAs($provider)->post("/requests/{$job->id}/cancel")->assertForbidden();
        $this->actingAs($this->customer())->post("/requests/{$job->id}/cancel")->assertForbidden();
        $this->actingAs($customer)->post("/requests/{$job->id}/cancel")->assertStatus(409);
        self::assertSame('in_progress', $job->fresh()->status->value);
    }

    public function test_event_history_is_private_to_owner_hired_provider_and_admin(): void
    {
        [$customer, $provider, $job] = $this->agreement();
        $candidate = $this->provider($job->category);
        $this->quote($job, $candidate, ['status' => 'declined']);
        $job->events()->create(['actor_id' => $customer->id, 'type' => 'booked', 'description' => 'Private timeline marker']);
        $this->actingAs($candidate)->get("/requests/{$job->id}")->assertOk()->assertDontSee('Private timeline marker');
        foreach ([$customer, $provider, User::factory()->admin()->create()] as $reader) {
            $this->actingAs($reader)->get("/requests/{$job->id}")->assertOk()->assertSee('Private timeline marker');
        }
    }
}
