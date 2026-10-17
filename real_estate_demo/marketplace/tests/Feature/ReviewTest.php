<?php

namespace Tests\Feature;

use App\Models\Category;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class ReviewTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    private function agreement(): array
    {
        $category = Category::factory()->create();
        $customer = $this->customer();
        $provider = $this->provider($category);
        $job = $this->job($customer, $category, ['status' => 'completed']);
        $quote = $this->quote($job, $provider, ['status' => 'accepted']);
        $job->update(['accepted_quote_id' => $quote->id]);

        return [$customer, $provider, $job];
    }

    public function test_only_one_customer_review_can_be_left_after_completion(): void
    {
        [$customer, $provider, $job] = $this->agreement();
        $this->actingAs($customer)->get("/requests/{$job->id}/review")->assertOk();
        $this->post("/requests/{$job->id}/review", ['rating' => 5, 'body' => 'Clear communication and a tidy repair.'])->assertRedirect();
        $this->post("/requests/{$job->id}/review", ['rating' => 1, 'body' => 'Duplicate'])->assertStatus(409);
        $review = $job->review()->sole();
        self::assertSame($provider->id, $review->provider_id);
        self::assertSame($customer->id, $review->customer_id);
        self::assertSame(5, $review->rating);
        self::assertSame(1, $provider->notifications()->count());
        $this->get('/professionals/'.$provider->profile->slug)->assertOk()->assertSee('Clear communication and a tidy repair.')->assertSee('5.0');
    }

    public function test_review_requires_owner_and_completed_job(): void
    {
        [$customer, $provider, $job] = $this->agreement();
        foreach ([$provider, $this->customer()] as $stranger) {
            $this->actingAs($stranger)->post("/requests/{$job->id}/review", ['rating' => 5, 'body' => 'Great work'])->assertForbidden();
        }
        foreach (['booked', 'cancelled'] as $status) {
            $job->update(['status' => $status]);
            $this->actingAs($customer)->post("/requests/{$job->id}/review", ['rating' => 5, 'body' => 'Great work'])->assertStatus(409);
            $this->get("/requests/{$job->id}/review")->assertStatus(409);
        }
        self::assertSame(0, $job->review()->count());
    }

    public function test_reviews_validate_rating_body_and_reject_forged_identity(): void
    {
        [$customer, $provider, $job] = $this->agreement();
        $valid = ['rating' => 5, 'body' => 'Great work'];
        foreach ([
            ['rating' => 0], ['rating' => 6], ['rating' => 2.5],
            ['body' => '   '], ['body' => str_repeat('x', 2001)],
            ['provider_id' => $provider->id], ['customer_id' => $customer->id],
        ] as $invalid) {
            $this->actingAs($customer)->postJson("/requests/{$job->id}/review", array_merge($valid, $invalid))->assertUnprocessable();
        }
        self::assertSame(0, $job->review()->count());
    }
}
