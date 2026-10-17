<?php

namespace Tests\Feature;

use App\Models\Category;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class ProposalTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    private function proposal(array $changes = []): array
    {
        return array_replace(['amount' => '185.50', 'scope' => 'Replace the mixer seals and test for leaks.',
            'available_date' => now('America/Chicago')->addDays(2)->toDateString()], $changes);
    }

    public function test_provider_can_quote_an_eligible_request_and_customer_is_notified(): void
    {
        $category = Category::factory()->create();
        $owner = $this->customer();
        $job = $this->job($owner, $category);
        $provider = $this->provider($category);

        $this->actingAs($provider)->post("/requests/{$job->id}/quotes", $this->proposal())
            ->assertRedirect("/requests/{$job->id}");

        $quote = $job->quotes()->sole();
        self::assertSame($provider->id, $quote->provider_id);
        self::assertSame(18550, $quote->amount_cents);
        self::assertSame(1, $quote->version);
        self::assertSame(1, $owner->notifications()->count());
    }

    #[DataProvider('ineligibleActors')]
    public function test_ineligible_actors_cannot_propose(string $case): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $actor = match ($case) {
            'customer' => $this->customer(),
            'category' => $this->provider(Category::factory()->create()),
            'area' => $this->provider($category, 'Cedar Park'),
            default => $this->provider($category, status: $case),
        };

        $this->actingAs($actor)->postJson("/requests/{$job->id}/quotes", $this->proposal())->assertForbidden();
        $this->assertDatabaseCount('quotes', 0);
        $this->assertDatabaseCount('notifications', 0);
    }

    public static function ineligibleActors(): array
    {
        return [['pending'], ['suspended'], ['category'], ['area'], ['customer']];
    }

    #[DataProvider('invalidProposals')]
    public function test_proposal_validation_protects_agreement_fields(string $case, string $error): void
    {
        $this->freezeTime();
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $changes = match ($case) {
            'date' => ['available_date' => now('America/Chicago')->subDay()->toDateString()],
            'amount' => ['amount' => '0.99'],
            'scope' => ['scope' => str_repeat('x', 5001)],
            default => [$case => '999'],
        };

        $this->actingAs($this->provider($category))->postJson("/requests/{$job->id}/quotes", $this->proposal($changes))
            ->assertUnprocessable()->assertJsonValidationErrors($error);
        $this->assertDatabaseCount('quotes', 0);
    }

    public static function invalidProposals(): array
    {
        return [['date', 'available_date'], ['amount', 'amount'], ['scope', 'scope'],
            ['provider_id', 'provider_id'], ['service_request_id', 'service_request_id'], ['status', 'status']];
    }

    public function test_duplicate_submission_and_closed_request_are_conflicts(): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $provider = $this->provider($category);
        $this->quote($job, $provider);

        $this->actingAs($provider)->postJson("/requests/{$job->id}/quotes", $this->proposal())->assertConflict();
        $this->assertDatabaseCount('quotes', 1);
        $job->update(['status' => 'booked']);
        $this->actingAs($this->provider($category))->postJson("/requests/{$job->id}/quotes", $this->proposal())->assertConflict();
        $this->assertDatabaseCount('quotes', 1);
    }

    public function test_quote_edits_require_the_current_version_and_keep_the_agreed_price_immutable(): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $provider = $this->provider($category);
        $quote = $this->quote($job, $provider);

        $this->actingAs($provider)->patch("/quotes/{$quote->id}", $this->proposal(['amount' => '210.00', 'version' => 1]))
            ->assertRedirect();
        self::assertSame(21000, $quote->fresh()->amount_cents);
        self::assertSame(2, $quote->fresh()->version);
        $this->patchJson("/quotes/{$quote->id}", $this->proposal(['amount' => '250.00', 'version' => 1]))->assertConflict();
        $quote->update(['status' => 'accepted']);
        $job->update(['status' => 'booked', 'accepted_quote_id' => $quote->id]);

        $this->patchJson("/quotes/{$quote->id}", $this->proposal(['amount' => '300.00', 'version' => 2]))->assertConflict();
        self::assertSame(21000, $quote->fresh()->amount_cents);
    }

    public function test_provider_cannot_change_another_providers_proposal(): void
    {
        $category = Category::factory()->create();
        $job = $this->job($this->customer(), $category);
        $quote = $this->quote($job, $this->provider($category));

        $this->actingAs($this->provider($category))->patchJson("/quotes/{$quote->id}", $this->proposal(['version' => 1]))->assertForbidden();
        self::assertSame(18550, $quote->fresh()->amount_cents);
    }
}
