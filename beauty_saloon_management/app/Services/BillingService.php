<?php

namespace App\Services;

use App\Models\Appointment;
use App\Models\Client;
use App\Models\Invoice;
use App\Models\Payment;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class BillingService
{
    public function issue(Appointment $appointment): Invoice
    {
        return DB::transaction(function () use ($appointment) {
            Appointment::whereKey($appointment->id)->update(['updated_at' => now()]);
            $appointment = Appointment::with(['items', 'client', 'stylist'])->lockForUpdate()->findOrFail($appointment->id);
            if ($existing = $appointment->invoice) {
                return $existing;
            }
            if ($appointment->status !== 'completed') {
                throw ValidationException::withMessages(['invoice' => 'Complete the visit before issuing an invoice.']);
            }
            $lines = $appointment->items->map(fn ($item) => ['name' => $item->name, 'price' => $item->price, 'quantity' => 1])->all();
            $rate = (int) $appointment->stylist->commission_rate;

            return $this->createInvoice($appointment->client, $lines, [
                'appointment_id' => $appointment->id, 'kind' => 'service',
                'stylist_id' => $appointment->stylist_id, 'stylist_name' => $appointment->stylist->name,
                'commission_rate' => $rate, 'commission_amount' => (int) round(array_sum(array_column($lines, 'price')) * $rate / 100),
            ]);
        }, 5);
    }

    /** @param array<int, array{name:string,price:int,quantity:int}> $lines Trusted catalogue snapshots, never request totals. */
    public function issueStandalone(Client $client, array $lines, string $kind, string $idempotencyKey): Invoice
    {
        if (! in_array($kind, ['retail', 'membership'], true) || $idempotencyKey === '' || strlen($idempotencyKey) > 255) {
            throw ValidationException::withMessages(['invoice' => 'Invalid sale type or request reference.']);
        }

        return DB::transaction(function () use ($client, $lines, $kind, $idempotencyKey) {
            Client::whereKey($client->id)->update(['updated_at' => now()]);
            if ($existing = Invoice::where('idempotency_key', $idempotencyKey)->first()) {
                if ($existing->client_id !== $client->id || $existing->kind !== $kind) {
                    throw ValidationException::withMessages(['invoice' => 'This request reference belongs to another sale.']);
                }

                return $existing;
            }

            return $this->createInvoice($client, $lines, ['kind' => $kind, 'idempotency_key' => $idempotencyKey, 'commission_amount' => 0]);
        }, 5);
    }

    /** @param array<int, array{name:string,price:int,quantity:int}> $lines
     * @param  array<string, mixed>  $attributes
     */
    private function createInvoice(Client $client, array $lines, array $attributes): Invoice
    {
        $subtotal = 0;
        if (count($lines) < 1 || count($lines) > 100) {
            throw ValidationException::withMessages(['invoice' => 'Choose between one and 100 line items.']);
        }
        foreach ($lines as $line) {
            if (! is_int($line['price']) || ! is_int($line['quantity']) || $line['price'] < 0 || $line['price'] > 100000000 || $line['quantity'] < 1 || $line['quantity'] > 1000 || trim($line['name']) === '') {
                throw ValidationException::withMessages(['invoice' => 'Invalid invoice line.']);
            }
            $subtotal += $line['price'] * $line['quantity'];
        }
        if ($subtotal > 100000000) {
            throw ValidationException::withMessages(['invoice' => 'The invoice exceeds the supported amount.']);
        }
        $rate = max(0, min(100, (int) config('studio.tax_percent')));
        $tax = (int) round($subtotal * $rate / 100);
        $invoice = Invoice::create($attributes + [
            'client_id' => $client->id, 'number' => 'DRAFT-'.Str::uuid(),
            'client_name' => $client->name, 'client_email' => $client->email,
            'currency' => config('studio.currency'), 'subtotal' => $subtotal,
            'tax' => $tax, 'tax_percent' => $rate, 'total' => $subtotal + $tax, 'issued_at' => now(),
        ]);
        $invoice->update(['number' => 'INV-'.now()->format('Y').'-'.str_pad((string) $invoice->id, 5, '0', STR_PAD_LEFT)]);
        $invoice->items()->createMany($lines);

        return $invoice;
    }

    public function pay(Invoice $invoice, string $method): Payment
    {
        if (! in_array($method, ['cash', 'card', 'transfer'], true)) {
            throw ValidationException::withMessages(['method' => 'Choose a supported payment method.']);
        }

        return DB::transaction(function () use ($invoice, $method) {
            Invoice::whereKey($invoice->id)->update(['updated_at' => now()]);
            $invoice = Invoice::lockForUpdate()->findOrFail($invoice->id);
            if ($existing = $invoice->payment) {
                return $existing;
            }
            $payment = $invoice->payment()->create(['reference' => 'RCT-'.str_pad((string) $invoice->id, 5, '0', STR_PAD_LEFT), 'method' => $method, 'amount' => $invoice->total, 'recorded_at' => now()]);
            $invoice->update(['status' => 'paid', 'paid_at' => now()]);

            return $payment;
        }, 5);
    }
}
