<?php

namespace Tests\Feature;

use App\Models\Category;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsMarketplace;
use Tests\TestCase;

class PaymentTest extends TestCase
{
    use BuildsMarketplace, RefreshDatabase;

    private function agreement(string $status = 'completed'): array
    {
        $category = Category::factory()->create();
        $customer = $this->customer();
        $provider = $this->provider($category);
        $job = $this->job($customer, $category, ['status' => $status]);
        $quote = $this->quote($job, $provider, ['status' => 'accepted', 'amount_cents' => 18550]);
        $job->update(['accepted_quote_id' => $quote->id]);

        return [$customer, $provider, $job];
    }

    public function test_checkout_uses_agreed_price_and_returns_one_receipt(): void
    {
        [$customer, $provider, $job] = $this->agreement();
        $this->actingAs($customer)->get("/requests/{$job->id}/checkout")->assertOk()->assertSee('$185.50')->assertDontSee('name="card', false);
        $this->post("/requests/{$job->id}/checkout", ['simulation_acknowledged' => '1', 'amount_cents' => 1])->assertRedirect();
        $this->post("/requests/{$job->id}/checkout", ['simulation_acknowledged' => '1'])->assertRedirect();
        $payment = $job->payment()->sole();
        self::assertSame(18550, $payment->amount_cents);
        self::assertSame('USD', $payment->currency);
        self::assertSame('simulated_paid', $payment->status);
        self::assertSame($customer->id, $payment->customer_id);
        $this->get("/payments/{$payment->id}")->assertOk()->assertSee('Simulated payment - no money was charged.')->assertSee('$185.50');
        $this->actingAs($provider)->get("/payments/{$payment->id}")->assertOk();
        $this->get("/requests/{$job->id}")->assertSee('View demo receipt');
        $provider->profile->update(['status' => 'suspended']);
        $this->actingAs($provider->fresh())->get("/payments/{$payment->id}")->assertOk();
        $this->actingAs($this->provider($job->category))->get("/payments/{$payment->id}")->assertForbidden();
        $this->actingAs($this->customer())->get("/payments/{$payment->id}")->assertForbidden();
        $this->actingAs(User::factory()->admin()->create())->get("/payments/{$payment->id}")->assertOk();
    }

    public function test_checkout_requires_completed_agreement_owner_and_acknowledgement(): void
    {
        [$customer, $provider, $job] = $this->agreement();
        $this->actingAs($customer)->postJson("/requests/{$job->id}/checkout", [])->assertUnprocessable();
        foreach ([$provider, $this->customer()] as $stranger) {
            $this->actingAs($stranger)->post("/requests/{$job->id}/checkout", ['simulation_acknowledged' => 1])->assertForbidden();
            $this->get("/requests/{$job->id}/checkout")->assertForbidden();
        }
        foreach (['booked', 'cancelled'] as $status) {
            $job->update(['status' => $status]);
            $this->actingAs($customer)->post("/requests/{$job->id}/checkout", ['simulation_acknowledged' => 1])->assertStatus(409);
            $this->get("/requests/{$job->id}/checkout")->assertStatus(409);
        }
        self::assertSame(0, $job->payment()->count());
    }
}
