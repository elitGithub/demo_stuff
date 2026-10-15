<?php

namespace Database\Seeders;

use App\Models\Client;
use App\Models\Invoice;
use App\Models\Membership;
use App\Models\MembershipPlan;
use App\Models\Product;
use App\Services\CommerceService;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class CommerceSeeder extends Seeder
{
    public function run(): void
    {
        if (! config('studio.demo')) {
            return;
        }
        DB::transaction(function (): void {
            if (Invoice::where('idempotency_key', 'retail:demo-retail-sale')->exists() && Membership::where('idempotency_key', 'demo-care-circle')->exists()) {
                return;
            }
            $commerce = app(CommerceService::class);
            foreach ([
                ['sku' => 'AT-DAILY', 'name' => 'Daily care shampoo', 'description' => 'A gentle daily cleanse. 250 ml.', 'price' => 2400, 'stock' => 18],
                ['sku' => 'AT-MASK', 'name' => 'Sunday repair mask', 'description' => 'A weekly moment of care. 200 ml.', 'price' => 3200, 'stock' => 12],
                ['sku' => 'AT-BRUSH', 'name' => 'Everyday detangling brush', 'description' => 'A simple finishing essential.', 'price' => 1800, 'stock' => 9],
            ] as $data) {
                $stock = $data['stock'];
                unset($data['stock']);
                $product = Product::firstOrCreate(['sku' => $data['sku']], $data);
                if ($product->wasRecentlyCreated) {
                    $commerce->adjustStock($product, $stock, 'Fictional demo opening stock');
                }
            }
            $plan = MembershipPlan::firstOrCreate(['name' => 'The care circle'], ['benefits' => 'One personal hair-care consultation and a seasonal care guide during each term. Arranged manually with the studio.', 'duration_days' => 30, 'price' => 4500])->refresh();
            MembershipPlan::firstOrCreate(['name' => 'Season of care'], ['benefits' => 'Three personal care consultations across a ninety-day term. Appointments are arranged with the studio; no automatic discounts apply.', 'duration_days' => 90, 'price' => 12000]);
            $client = Client::firstOrCreate(['email' => 'care.demo@example.test'], ['name' => 'Avery Lane', 'source' => 'demo']);
            if ($plan->active && ! $plan->memberships()->where('client_id', $client->id)->exists()) {
                $commerce->enrol($client, $plan, now(config('studio.timezone'))->toDateString(), 'cash', 'demo-care-circle');
            }
            $product = Product::where('sku', 'AT-DAILY')->firstOrFail();
            if (! Invoice::where('idempotency_key', 'retail:demo-retail-sale')->exists() && $product->active && $product->stock >= 2) {
                $commerce->checkout($client, [['product_id' => $product->id, 'quantity' => 2]], 'cash', 'demo-retail-sale');
            }
        });
    }
}
