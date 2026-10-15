<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Service;
use App\Models\Stylist;
use App\Services\BillingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class BillingTest extends TestCase
{
    use RefreshDatabase;

    private function appointment(): Appointment
    {
        $client = Client::create(['name' => 'Test Client', 'email' => 'client@example.test']);
        $stylist = Stylist::create(['name' => 'Alex', 'title' => 'Stylist']);
        $service = Service::create(['name' => 'Cut', 'category' => 'Hair', 'price' => 6500, 'duration' => 45]);
        $appointment = Appointment::create(['client_id' => $client->id, 'stylist_id' => $stylist->id, 'starts_at' => now()->subHour(), 'ends_at' => now(), 'status' => 'completed', 'total' => 6500]);
        $appointment->items()->create(['service_id' => $service->id, 'name' => 'Cut', 'price' => 6500, 'duration' => 45]);

        return $appointment;
    }

    public function test_invoice_snapshots_are_immutable_and_issuance_is_idempotent(): void
    {
        $appointment = $this->appointment();
        $billing = app(BillingService::class);
        $invoice = $billing->issue($appointment);
        Service::query()->update(['price' => 9000, 'name' => 'New cut']);
        $this->assertSame($invoice->id, $billing->issue($appointment)->id);
        $this->assertSame(6500, $invoice->total);
        $this->assertSame('Cut', $invoice->items->first()->name);
        $this->assertSame(1, Invoice::count());
    }

    public function test_duplicate_payment_does_not_double_count(): void
    {
        $billing = app(BillingService::class);
        $invoice = $billing->issue($this->appointment());
        $first = $billing->pay($invoice, 'cash');
        $second = $billing->pay($invoice, 'cash');
        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, Payment::count());
        $this->assertSame('paid', $invoice->fresh()->status);
    }

    public function test_cancelled_appointment_cannot_be_invoiced(): void
    {
        $appointment = $this->appointment();
        $appointment->update(['status' => 'cancelled']);
        $this->expectException(ValidationException::class);
        app(BillingService::class)->issue($appointment);
    }
}
