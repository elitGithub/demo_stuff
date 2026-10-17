<?php

namespace Tests\Feature;

use App\Enums\JobStatus;
use App\Enums\ProviderStatus;
use App\Enums\QuoteStatus;
use App\Enums\Role;
use App\Models\Category;
use App\Models\Payment;
use App\Models\ProviderProfile;
use App\Models\Review;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class MarketplaceSchemaTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_a_provider_has_only_one_quote_per_request(): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $provider = $this->provider($category);
        $this->quote($job, $provider);

        $this->expectException(QueryException::class);
        $this->quote($job, $provider);
    }

    public function test_a_request_has_only_one_payment(): void
    {
        $job = $this->job($this->customer(), Category::factory()->create());
        $attributes = [
            'service_request_id' => $job->id, 'customer_id' => $job->customer_id,
            'receipt_number' => 'e58a454e-ccf5-4e18-a909-ce1c02bd8910',
            'amount_cents' => 18550, 'currency' => 'USD', 'status' => 'simulated_paid', 'paid_at' => now(),
        ];
        Payment::create($attributes);

        $this->expectException(QueryException::class);
        Payment::create(array_replace($attributes, [
            'receipt_number' => 'd7a8514d-c94b-4a40-b2e6-7d2b9c691b6a',
        ]));
    }

    public function test_a_request_has_only_one_review(): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $provider = $this->provider($category);
        $attributes = [
            'service_request_id' => $job->id, 'customer_id' => $job->customer_id,
            'provider_id' => $provider->id, 'rating' => 5, 'body' => 'Thoughtful work and a tidy finish.',
        ];
        Review::create($attributes);

        $this->expectException(QueryException::class);
        Review::create($attributes);
    }

    public function test_demo_entry_keys_are_unique(): void
    {
        User::factory()->create(['demo_key' => 'customer']);

        $this->expectException(QueryException::class);
        User::factory()->create(['demo_key' => 'customer']);
    }

    public function test_agreement_relationships_preserve_the_provider_customer_and_cents(): void
    {
        $category = Category::factory()->create();
        $customer = $this->customer();
        $provider = $this->provider($category);
        $job = $this->job($customer, $category);
        $quote = $this->quote($job, $provider, ['status' => 'accepted']);
        $job->update(['accepted_quote_id' => $quote->id, 'status' => 'booked']);

        self::assertSame(Role::Customer, $job->customer->role);
        self::assertSame(Role::Provider, $job->acceptedQuote->provider->role);
        self::assertSame(18550, $job->acceptedQuote->amount_cents);
        self::assertSame(QuoteStatus::Accepted, $job->acceptedQuote->status);
        self::assertSame(JobStatus::Booked, $job->status);
        self::assertTrue($provider->profile->categories->contains($category));
        self::assertSame(['Austin'], $provider->profile->service_areas);
    }

    public function test_new_provider_profiles_need_approval(): void
    {
        $profile = ProviderProfile::factory()->create();

        self::assertSame(ProviderStatus::Pending, $profile->status);
    }
}
