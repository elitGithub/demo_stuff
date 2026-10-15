<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\Service;
use App\Models\Stylist;
use App\Models\User;
use App\Services\BillingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class BusinessFoundationTest extends TestCase
{
    use RefreshDatabase;

    public function test_standalone_invoice_freezes_quantity_totals_and_retries(): void
    {
        config(['studio.tax_percent' => 10]);
        $client = Client::create(['name' => 'Retail Client']);
        $billing = app(BillingService::class);
        $invoice = $billing->issueStandalone($client, [['name' => 'Shampoo', 'price' => 1250, 'quantity' => 3]], 'retail', 'sale-1');
        $this->assertSame(3750, $invoice->subtotal);
        $this->assertSame(4125, $invoice->total);
        $this->assertSame(0, $invoice->commission_amount);
        $this->assertSame($invoice->id, $billing->issueStandalone($client, [['name' => 'Changed', 'price' => 500, 'quantity' => 1]], 'retail', 'sale-1')->id);
        $this->assertSame('Shampoo', $invoice->items->first()->name);
        $document = new \DOMDocument;
        $document->loadHTML(view('invoices.document', ['invoice' => $invoice, 'receipt' => false])->render(), LIBXML_NOERROR | LIBXML_NOWARNING);
        $lineAmount = (new \DOMXPath($document))->evaluate('string(//td[normalize-space(.)="Shampoo"]/following-sibling::td[2])');
        $this->assertSame('37.50', trim($lineAmount));
        $this->actingAs(User::factory()->create())->get(route('invoices.show', $invoice))->assertOk()->assertSee('37.50');
    }

    public function test_idempotency_key_cannot_return_another_clients_invoice(): void
    {
        $billing = app(BillingService::class);
        $billing->issueStandalone(Client::create(['name' => 'One']), [['name' => 'Item', 'price' => 100, 'quantity' => 1]], 'retail', 'same');
        $this->expectException(ValidationException::class);
        $billing->issueStandalone(Client::create(['name' => 'Two']), [['name' => 'Item', 'price' => 100, 'quantity' => 1]], 'retail', 'same');
    }

    public function test_commission_is_a_snapshot_of_service_subtotal_excluding_tax(): void
    {
        config(['studio.tax_percent' => 20]);
        $stylist = Stylist::create(['name' => 'Alex', 'title' => 'Stylist', 'commission_rate' => 15]);
        $appointment = Appointment::create(['client_id' => Client::create(['name' => 'Client'])->id, 'stylist_id' => $stylist->id, 'starts_at' => now()->subHour(), 'ends_at' => now(), 'status' => 'completed', 'total' => 10000]);
        $appointment->items()->create(['service_id' => Service::create(['name' => 'Cut', 'category' => 'Hair', 'price' => 10000, 'duration' => 60])->id, 'name' => 'Cut', 'price' => 10000, 'duration' => 60]);
        $invoice = app(BillingService::class)->issue($appointment);
        $stylist->update(['commission_rate' => 30, 'name' => 'Changed']);
        $this->assertSame(1500, $invoice->commission_amount);
        $this->assertSame('Alex', $invoice->stylist_name);
        $this->assertSame(12000, $invoice->total);
    }

    public function test_staff_is_denied_finance_and_management_but_can_use_schedule(): void
    {
        $user = User::factory()->create(['role' => 'staff']);
        $this->assertFalse(Gate::forUser($user)->allows('manage-studio'));
        $this->actingAs($user)->get('/app/invoices')->assertForbidden();
        $this->get('/app/access')->assertForbidden();
        $this->get('/app/appointments')->assertOk();
    }

    public function test_disabled_user_loses_existing_session_and_cannot_log_in(): void
    {
        $user = User::factory()->create(['active' => false]);
        $this->actingAs($user)->get('/app')->assertRedirect('/login');
        $this->assertGuest();
        $this->post('/login', ['email' => $user->email, 'password' => 'password'])->assertSessionHasErrors('email');
    }

    public function test_only_owner_can_manage_accounts_and_cannot_disable_self(): void
    {
        $manager = User::factory()->create(['role' => 'manager']);
        $this->actingAs($manager)->post('/app/access', ['name' => 'Bad'])->assertForbidden();
        $owner = User::factory()->create(['role' => 'owner']);
        $this->actingAs($owner)->put('/app/access/'.$owner->id, ['name' => $owner->name, 'email' => $owner->email, 'role' => 'staff', 'active' => false])->assertSessionHasErrors('role');
        $this->assertSame('owner', $owner->fresh()->role);
    }
}
