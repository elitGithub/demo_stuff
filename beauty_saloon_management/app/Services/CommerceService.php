<?php

namespace App\Services;

use App\Models\Client;
use App\Models\Invoice;
use App\Models\Membership;
use App\Models\MembershipPlan;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

class CommerceService
{
    public function __construct(private BillingService $billing) {}

    /** @param array<int, array{product_id: int, quantity: int}> $lines */
    public function checkout(Client $client, array $lines, string $method, string $idempotencyKey, ?User $actor = null): Invoice
    {
        Validator::make(['lines' => $lines, 'idempotency_key' => $idempotencyKey], [
            'lines' => 'required|array|min:1|max:50', 'lines.*.product_id' => 'required|integer|distinct',
            'lines.*.quantity' => 'required|integer|min:1|max:1000', 'idempotency_key' => 'required|string|max:80',
        ])->validate();
        $quantities = collect($lines)->mapWithKeys(fn (array $line): array => [(int) $line['product_id'] => (int) $line['quantity']])->sortKeys();

        return DB::transaction(function () use ($client, $quantities, $method, $idempotencyKey, $actor): Invoice {
            Client::whereKey($client->id)->update(['updated_at' => now()]);
            $key = 'retail:'.$idempotencyKey;
            if ($existing = Invoice::where('idempotency_key', $key)->first()) {
                $sold = StockMovement::where('invoice_id', $existing->id)->get()->mapWithKeys(fn (StockMovement $movement): array => [$movement->product_id => -$movement->quantity])->sortKeys();
                if ($existing->client_id !== $client->id || $sold->all() !== $quantities->all()) {
                    throw ValidationException::withMessages(['idempotency_key' => 'This checkout reference belongs to a different sale. Start a new checkout.']);
                }

                return $existing;
            }
            $products = Product::whereIn('id', $quantities->keys())->orderBy('id')->lockForUpdate()->get();
            if ($products->count() !== $quantities->count()) {
                throw ValidationException::withMessages(['lines' => 'One of the selected products no longer exists.']);
            }
            $snapshots = [];
            foreach ($products as $product) {
                if (! $product->active || $product->stock < $quantities[$product->id]) {
                    throw ValidationException::withMessages(['lines' => $product->name.' is unavailable or has insufficient stock.']);
                }
                $snapshots[] = ['name' => $product->name, 'price' => $product->price, 'quantity' => $quantities[$product->id]];
            }
            $invoice = $this->billing->issueStandalone($client, $snapshots, 'retail', $key);
            foreach ($products as $product) {
                $quantity = $quantities[$product->id];
                if (! Product::whereKey($product->id)->where('stock', '>=', $quantity)->decrement('stock', $quantity)) {
                    throw ValidationException::withMessages(['lines' => $product->name.' has insufficient stock.']);
                }
                $product->movements()->create(['invoice_id' => $invoice->id, 'user_id' => $actor?->id, 'quantity' => -$quantity, 'balance' => $product->stock - $quantity, 'reason' => 'Retail sale '.$invoice->number]);
            }
            $this->billing->pay($invoice, $method);

            return $invoice->refresh();
        }, 5);
    }

    public function adjustStock(Product $product, int $quantity, string $reason, ?User $actor = null): StockMovement
    {
        Validator::make(compact('quantity', 'reason'), ['quantity' => 'required|integer|between:-100000,100000|not_in:0', 'reason' => 'required|string|max:255'])->validate();

        return DB::transaction(function () use ($product, $quantity, $reason, $actor): StockMovement {
            Product::whereKey($product->id)->update(['updated_at' => now()]);
            $product = Product::lockForUpdate()->findOrFail($product->id);
            $balance = $product->stock + $quantity;
            if ($balance < 0 || $balance > 1000000) {
                throw ValidationException::withMessages(['quantity' => 'Stock must stay between zero and 1,000,000 units.']);
            }
            $product->update(['stock' => $balance]);

            return $product->movements()->create(['quantity' => $quantity, 'balance' => $balance, 'reason' => $reason, 'user_id' => $actor?->id]);
        }, 5);
    }

    public function enrol(Client $client, MembershipPlan $plan, string $startsOn, string $method, string $idempotencyKey): Membership
    {
        Validator::make(['starts_on' => $startsOn], ['starts_on' => 'required|date_format:Y-m-d'])->validate();

        return $this->purchaseMembership($client, $plan, $startsOn, $method, $idempotencyKey);
    }

    public function renew(Membership $membership, string $method, string $idempotencyKey): Membership
    {
        $startsOn = max(now(config('studio.timezone'))->toDateString(), $membership->ends_on->toDateString());

        return $this->purchaseMembership($membership->client, $membership->plan, $startsOn, $method, $idempotencyKey, $membership);
    }

    private function purchaseMembership(Client $client, MembershipPlan $plan, string $startsOn, string $method, string $idempotencyKey, ?Membership $previous = null): Membership
    {
        Validator::make(['idempotency_key' => $idempotencyKey], ['idempotency_key' => 'required|string|max:80'])->validate();

        return DB::transaction(function () use ($client, $plan, $startsOn, $method, $idempotencyKey, $previous): Membership {
            Client::whereKey($client->id)->update(['updated_at' => now()]);
            if ($existing = Membership::where('idempotency_key', $idempotencyKey)->first()) {
                if ($existing->client_id !== $client->id || $existing->membership_plan_id !== $plan->id || $existing->previous_membership_id !== $previous?->id || (! $previous && $existing->starts_on->toDateString() !== $startsOn)) {
                    throw ValidationException::withMessages(['idempotency_key' => 'This purchase reference belongs to a different membership. Start a new purchase.']);
                }

                return $existing;
            }
            $plan = MembershipPlan::lockForUpdate()->findOrFail($plan->id);
            if (! $plan->active) {
                throw ValidationException::withMessages(['membership_plan_id' => 'This plan is archived. Choose an available plan.']);
            }
            if ($previous && Membership::where('previous_membership_id', $previous->id)->exists()) {
                throw ValidationException::withMessages(['membership' => 'This term has already been renewed. Renew the latest term instead.']);
            }
            $endsOn = CarbonImmutable::parse($startsOn)->addDays($plan->duration_days)->toDateString();
            if (Membership::where('client_id', $client->id)->where('membership_plan_id', $plan->id)->whereDate('starts_on', '<', $endsOn)->whereDate('ends_on', '>', $startsOn)->exists()) {
                throw ValidationException::withMessages(['starts_on' => 'This client already has this plan during those dates. Renew the existing term instead.']);
            }
            $invoice = $this->billing->issueStandalone($client, [['name' => $plan->name.' · '.$plan->duration_days.' days', 'price' => $plan->price, 'quantity' => 1]], 'membership', 'membership:'.$idempotencyKey);
            $this->billing->pay($invoice, $method);

            return Membership::create([
                'client_id' => $client->id, 'membership_plan_id' => $plan->id, 'invoice_id' => $invoice->id,
                'previous_membership_id' => $previous?->id, 'idempotency_key' => $idempotencyKey,
                'plan_name' => $plan->name, 'benefits' => $plan->benefits, 'price' => $plan->price,
                'duration_days' => $plan->duration_days, 'starts_on' => $startsOn, 'ends_on' => $endsOn,
            ]);
        }, 5);
    }
}
