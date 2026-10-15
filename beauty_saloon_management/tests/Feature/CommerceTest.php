<?php

namespace Tests\Feature;

use App\Models\Client;
use App\Models\Invoice;
use App\Models\Membership;
use App\Models\MembershipPlan;
use App\Models\Product;
use App\Models\User;
use App\Services\CommerceService;
use Database\Seeders\CommerceSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class CommerceTest extends TestCase
{
    use RefreshDatabase;

    public function test_retail_requires_authentication_and_manager_permission(): void
    {
        $this->get('/app/retail')->assertRedirect('/login');
        $staff = User::factory()->create(['role' => 'staff']);
        $this->actingAs($staff)->get('/app/retail')->assertForbidden();
        $this->post('/app/retail/checkout', [])->assertForbidden();
        $this->get('/app/memberships')->assertForbidden();
        $this->post('/app/memberships', [])->assertForbidden();
    }

    public function test_checkout_uses_catalogue_prices_and_quantities_and_retries_once(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $client = Client::create(['name' => 'Fictional client']);
        $shampoo = Product::factory()->create(['price' => 1250, 'stock' => 10]);
        $brush = Product::factory()->create(['price' => 900, 'stock' => 5]);
        $payload = ['client_id' => $client->id, 'method' => 'cash', 'idempotency_key' => (string) Str::uuid(), 'total' => 1, 'lines' => [
            ['product_id' => $shampoo->id, 'quantity' => 2, 'price' => 1],
            ['product_id' => $brush->id, 'quantity' => 3, 'price' => 1],
        ]];

        $this->actingAs($manager)->post('/app/retail/checkout', $payload)->assertRedirect();
        $this->post('/app/retail/checkout', $payload)->assertRedirect();

        $invoice = Invoice::sole();
        $this->assertSame(5200, $invoice->subtotal);
        $this->assertSame('paid', $invoice->status);
        $this->assertSame(8, $shampoo->fresh()->stock);
        $this->assertSame(2, $brush->fresh()->stock);
        $this->assertDatabaseCount('payments', 1);
        $this->assertDatabaseCount('stock_movements', 2);
        $this->assertSame([2, 3], $invoice->items->pluck('quantity')->all());
    }

    public function test_insufficient_stock_rolls_back_the_whole_sale(): void
    {
        $client = Client::create(['name' => 'Fictional client']);
        $available = Product::factory()->create(['stock' => 5]);
        $scarce = Product::factory()->create(['stock' => 1]);

        try {
            app(CommerceService::class)->checkout($client, [
                ['product_id' => $available->id, 'quantity' => 2],
                ['product_id' => $scarce->id, 'quantity' => 2],
            ], 'cash', (string) Str::uuid());
            $this->fail('Insufficient stock must reject the sale.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('lines', $exception->errors());
        }

        $this->assertSame(5, $available->fresh()->stock);
        $this->assertSame(1, $scarce->fresh()->stock);
        $this->assertDatabaseCount('invoices', 0);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('stock_movements', 0);
    }

    public function test_failed_payment_rolls_back_stock_and_invoice(): void
    {
        $client = Client::create(['name' => 'Fictional client']);
        $product = Product::factory()->create(['stock' => 5]);

        try {
            app(CommerceService::class)->checkout($client, [['product_id' => $product->id, 'quantity' => 2]], 'unsupported', (string) Str::uuid());
            $this->fail('An invalid payment method must reject the sale.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('method', $exception->errors());
        }

        $this->assertSame(5, $product->fresh()->stock);
        $this->assertDatabaseCount('invoices', 0);
        $this->assertDatabaseCount('stock_movements', 0);
    }

    public function test_stock_adjustment_records_a_reason_and_rejects_negative_balance(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $product = Product::factory()->create(['stock' => 3]);

        $this->actingAs($manager)->post('/app/retail/'.$product->id.'/stock', ['quantity' => 4, 'reason' => 'Delivery received'])->assertRedirect();
        $this->post('/app/retail/'.$product->id.'/stock', ['quantity' => -8, 'reason' => 'Damaged'])->assertSessionHasErrors('quantity');

        $this->assertSame(7, $product->fresh()->stock);
        $this->assertDatabaseHas('stock_movements', ['product_id' => $product->id, 'quantity' => 4, 'balance' => 7, 'reason' => 'Delivery received', 'user_id' => $manager->id]);
        $this->assertDatabaseCount('stock_movements', 1);
    }

    public function test_membership_renewal_preserves_prior_terms_and_starts_after_current_term(): void
    {
        $this->travelTo(now()->setDate(2026, 10, 15)->startOfDay());
        $client = Client::create(['name' => 'Fictional member']);
        $plan = MembershipPlan::factory()->create(['name' => 'Care club', 'benefits' => 'One consultation', 'price' => 4500, 'duration_days' => 30]);
        $commerce = app(CommerceService::class);
        $first = $commerce->enrol($client, $plan, '2026-10-15', 'cash', (string) Str::uuid());
        $plan->update(['name' => 'Care plus', 'benefits' => 'Two consultations', 'price' => 6000, 'duration_days' => 60]);
        $key = (string) Str::uuid();

        $renewal = $commerce->renew($first, 'transfer', $key);
        $retry = $commerce->renew($first, 'transfer', $key);

        $this->assertSame($renewal->id, $retry->id);
        $this->assertSame('2026-11-14', $first->ends_on->format('Y-m-d'));
        $this->assertSame('Care club', $first->fresh()->plan_name);
        $this->assertSame('One consultation', $first->fresh()->benefits);
        $this->assertSame(4500, $first->fresh()->price);
        $this->assertSame('2026-11-14', $renewal->starts_on->format('Y-m-d'));
        $this->assertSame('2027-01-13', $renewal->ends_on->format('Y-m-d'));
        $this->assertSame('Care plus', $renewal->plan_name);
        $this->assertSame(6000, $renewal->price);
        $this->assertDatabaseCount('memberships', 2);
        $this->assertDatabaseCount('payments', 2);
    }

    public function test_an_already_renewed_term_cannot_be_charged_again_with_another_key(): void
    {
        $client = Client::create(['name' => 'Fictional member']);
        $plan = MembershipPlan::factory()->create();
        $commerce = app(CommerceService::class);
        $first = $commerce->enrol($client, $plan, '2026-10-15', 'cash', (string) Str::uuid());
        $commerce->renew($first, 'cash', (string) Str::uuid());

        try {
            $commerce->renew($first, 'cash', (string) Str::uuid());
            $this->fail('Already renewed terms must not charge again.');
        } catch (ValidationException $exception) {
            $this->assertArrayHasKey('membership', $exception->errors());
        }

        $this->assertDatabaseCount('memberships', 2);
        $this->assertDatabaseCount('payments', 2);
    }

    public function test_catalogue_forms_save_and_render_escaped_data(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $this->actingAs($manager)->post('/app/retail/products', ['name' => '<script>retail</script>', 'sku' => 'CARE-1', 'price_amount' => '12.95', 'active' => 1])->assertRedirect();
        $this->post('/app/memberships/plans', ['name' => 'Care plan', 'benefits' => '<script>benefits</script>', 'duration_days' => 30, 'price_amount' => '45.25', 'active' => 1])->assertRedirect();

        $this->assertDatabaseHas('products', ['sku' => 'CARE-1', 'price' => 1295, 'stock' => 0]);
        $this->assertDatabaseHas('membership_plans', ['name' => 'Care plan', 'price' => 4525]);
        $this->get('/app/retail')->assertOk()->assertSee('&lt;script&gt;retail&lt;/script&gt;', false)->assertDontSee('<script>retail</script>', false);
        $this->get('/app/memberships')->assertOk()->assertSee('&lt;script&gt;benefits&lt;/script&gt;', false)->assertDontSee('<script>benefits</script>', false);
    }

    public function test_demo_seeding_is_gated_and_does_not_reset_existing_commerce(): void
    {
        config(['studio.demo' => false]);
        $this->seed(CommerceSeeder::class);
        $this->assertDatabaseCount('products', 0);
        config(['studio.demo' => true]);
        $this->seed(CommerceSeeder::class);
        $product = Product::firstOrFail();
        $product->update(['stock' => 2, 'price' => 1234]);
        MembershipPlan::firstOrFail()->update(['name' => 'Studio edited plan']);
        Client::where('email', 'care.demo@example.test')->update(['email' => 'edited@example.test']);
        $count = Product::count();

        $this->seed(CommerceSeeder::class);

        $this->assertSame($count, Product::count());
        $this->assertSame(2, $product->fresh()->stock);
        $this->assertSame(1234, $product->fresh()->price);
        $this->assertDatabaseCount('membership_plans', 2);
        $this->assertDatabaseCount('memberships', 1);
        $this->assertDatabaseCount('clients', 1);
        $this->assertDatabaseCount('invoices', 2);
    }

    public function test_catalogue_edits_cannot_overwrite_stock_or_previous_purchase_terms(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $product = Product::factory()->create(['stock' => 7]);
        $plan = MembershipPlan::factory()->create();

        $this->actingAs($manager)->put('/app/retail/products/'.$product->id, ['name' => 'Updated product', 'sku' => $product->sku, 'price_amount' => '21.50', 'active' => 1, 'stock' => -100])->assertRedirect();
        $this->put('/app/memberships/plans/'.$plan->id, ['name' => 'Updated plan', 'benefits' => 'A care review', 'duration_days' => 60, 'price_amount' => '90.00'])->assertRedirect();

        $this->assertSame(7, $product->fresh()->stock);
        $this->assertSame(2150, $product->fresh()->price);
        $this->assertSame(60, $plan->fresh()->duration_days);
        $this->assertFalse($plan->fresh()->active);
    }

    public function test_membership_http_purchase_ignores_submitted_price_and_end_date(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $client = Client::create(['name' => 'Fictional member']);
        $plan = MembershipPlan::factory()->create(['price' => 4500, 'duration_days' => 30]);
        $payload = ['client_id' => $client->id, 'membership_plan_id' => $plan->id, 'starts_on' => '2026-10-15', 'ends_on' => '2099-01-01', 'price' => 1, 'method' => 'cash', 'idempotency_key' => (string) Str::uuid()];

        $this->actingAs($manager)->post('/app/memberships', $payload)->assertRedirect();
        $this->post('/app/memberships', $payload)->assertRedirect();

        $membership = Membership::sole();
        $this->assertSame(4500, $membership->price);
        $this->assertSame('2026-11-14', $membership->ends_on->toDateString());
        $this->assertSame('paid', $membership->invoice->status);
        $this->assertDatabaseCount('payments', 1);
        $this->get('/app/memberships')->assertOk()->assertSee($membership->plan_name);
    }

    public function test_reusing_checkout_reference_with_a_different_cart_is_rejected(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $client = Client::create(['name' => 'Fictional client']);
        $product = Product::factory()->create(['stock' => 10]);
        $key = (string) Str::uuid();
        app(CommerceService::class)->checkout($client, [['product_id' => $product->id, 'quantity' => 1]], 'cash', $key);

        $this->actingAs($manager)->post('/app/retail/checkout', ['client_id' => $client->id, 'method' => 'cash', 'idempotency_key' => $key, 'lines' => [['product_id' => $product->id, 'quantity' => 2]]])->assertSessionHasErrors('idempotency_key');

        $this->assertSame(9, $product->fresh()->stock);
        $this->assertDatabaseCount('invoices', 1);
        $this->assertDatabaseCount('payments', 1);
    }

    public function test_archived_product_and_negative_quantities_cannot_be_sold(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $client = Client::create(['name' => 'Fictional client']);
        $product = Product::factory()->create(['stock' => 10, 'active' => false]);
        $payload = ['client_id' => $client->id, 'method' => 'cash', 'idempotency_key' => (string) Str::uuid(), 'lines' => [['product_id' => $product->id, 'quantity' => 1]]];

        $this->actingAs($manager)->post('/app/retail/checkout', $payload)->assertSessionHasErrors('lines');
        $payload['lines'][0]['quantity'] = -1;
        $this->post('/app/retail/checkout', $payload)->assertSessionHasErrors('lines.0.quantity');

        $this->assertSame(10, $product->fresh()->stock);
        $this->assertDatabaseCount('invoices', 0);
    }

    public function test_expired_membership_renews_from_today_and_archived_plan_cannot_renew(): void
    {
        $this->travelTo(now()->setDate(2026, 10, 15)->startOfDay());
        $manager = User::factory()->create(['role' => 'manager']);
        $client = Client::create(['name' => 'Fictional member']);
        $plan = MembershipPlan::factory()->create(['duration_days' => 30]);
        $first = app(CommerceService::class)->enrol($client, $plan, '2026-08-01', 'cash', (string) Str::uuid());
        $this->assertSame('Expired', $first->status());

        $this->actingAs($manager)->post('/app/memberships/'.$first->id.'/renew', ['method' => 'cash', 'idempotency_key' => (string) Str::uuid()])->assertRedirect();

        $renewal = Membership::latest('id')->firstOrFail();
        $this->assertSame('2026-10-15', $renewal->starts_on->toDateString());
        $this->assertSame('Active', $renewal->status());
        $plan->update(['active' => false]);
        $this->post('/app/memberships/'.$renewal->id.'/renew', ['method' => 'cash', 'idempotency_key' => (string) Str::uuid()])->assertSessionHasErrors('membership_plan_id');
        $this->assertDatabaseCount('memberships', 2);
    }

    public function test_large_catalogue_can_sell_one_product_without_a_line_limit_error(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $client = Client::create(['name' => 'Fictional client']);
        $products = Product::factory()->count(51)->create(['stock' => 1]);
        $lines = $products->map(fn (Product $product, int $index): array => ['product_id' => $product->id, 'quantity' => $index === 0 ? 1 : 0])->all();

        $this->actingAs($manager)->post('/app/retail/checkout', ['client_id' => $client->id, 'method' => 'cash', 'idempotency_key' => (string) Str::uuid(), 'lines' => $lines])->assertSessionHasNoErrors();

        $this->assertDatabaseCount('invoices', 1);
        $this->assertSame(0, $products->first()->fresh()->stock);
    }
}
