<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class MarketplaceJourneyTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    public function test_customer_and_provider_complete_the_marketplace_journey(): void
    {
        Storage::fake('request-photos');
        $category = Category::factory()->create();
        $customer = $this->customer();
        $provider = $this->provider($category);
        $this->actingAs($customer)->post('/requests', [
            'title' => 'Repair kitchen tap', 'description' => 'Slow leak at the base.',
            'category_id' => $category->id, 'service_area' => 'Austin',
            'street_address' => '1842 Juniper Lane', 'preferred_date' => now()->addDays(3)->toDateString(),
            'budget' => '250', 'photos' => [UploadedFile::fake()->image('tap.png', 480, 320)],
        ])->assertRedirect();
        $job = $customer->requests()->sole();
        Storage::disk('request-photos')->assertExists($job->photos()->sole()->path);
        $this->actingAs($provider)->post("/requests/{$job->id}/quotes", [
            'amount' => '185.50', 'available_date' => now()->addDays(3)->toDateString(),
            'scope' => 'Replace seals, test and clean up.',
        ])->assertRedirect();
        $quote = $job->quotes()->sole();
        $this->actingAs($customer)->post("/conversations/{$quote->id}/messages", ['body' => 'Morning works for me.'])->assertRedirect();
        $this->post("/quotes/{$quote->id}/accept", ['version' => $quote->version])->assertRedirect();
        $this->actingAs($provider)->get("/requests/{$job->id}")->assertOk()->assertSee('1842 Juniper Lane');
        foreach (['in_progress', 'awaiting_confirmation'] as $status) {
            $this->post("/requests/{$job->id}/status", ['status' => $status])->assertRedirect();
        }
        $this->actingAs($customer)->post("/requests/{$job->id}/status", ['status' => 'completed'])->assertRedirect();
        $this->post("/requests/{$job->id}/checkout", ['simulation_acknowledged' => '1'])->assertRedirect();
        $this->post("/requests/{$job->id}/review", ['rating' => 5, 'body' => 'A neat repair and clear communication.'])->assertRedirect();
        self::assertSame(18550, $job->payment()->sole()->amount_cents);
        self::assertSame($provider->id, $job->review()->sole()->provider_id);
        self::assertSame('completed', $job->fresh()->status->value);
        $this->actingAs(User::factory()->admin()->create())->get('/admin')->assertOk();
    }
}
