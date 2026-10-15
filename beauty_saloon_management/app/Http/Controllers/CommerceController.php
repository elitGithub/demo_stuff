<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Invoice;
use App\Models\Membership;
use App\Models\MembershipPlan;
use App\Models\Product;
use App\Models\StockMovement;
use App\Services\CommerceService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\View\View;

class CommerceController extends Controller
{
    public function retail(): View
    {
        return view('commerce.retail', [
            'products' => Product::orderBy('name')->get(), 'clients' => Client::orderBy('name')->get(['id', 'name', 'email']),
            'movements' => StockMovement::with(['product', 'invoice', 'user'])->latest('id')->paginate(20, ['*'], 'stock_page'),
            'sales' => Invoice::where('kind', 'retail')->with('client')->latest('id')->paginate(10, ['*'], 'sales_page'),
        ]);
    }

    public function saveProduct(Request $request, ?Product $product = null): RedirectResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:120', 'sku' => ['required', 'string', 'max:60', Rule::unique('products')->ignore($product)],
            'description' => 'nullable|string|max:2000', 'price_amount' => 'required|numeric|min:0.01|max:10000|decimal:0,2', 'active' => 'nullable|boolean',
        ]);
        $data['price'] = (int) round((float) $data['price_amount'] * 100);
        $data['active'] = $request->boolean('active');
        unset($data['price_amount']);
        ($product ?? new Product)->fill($data)->save();

        return redirect()->route('retail.index')->with('success', 'Product saved. Add or correct inventory using a stock adjustment.');
    }

    public function adjustStock(Request $request, Product $product, CommerceService $commerce): RedirectResponse
    {
        $data = $request->validate(['quantity' => 'required|integer|between:-100000,100000|not_in:0', 'reason' => 'required|string|max:255']);
        $commerce->adjustStock($product, (int) $data['quantity'], $data['reason'], $request->user());

        return redirect()->route('retail.index')->with('success', 'Stock adjustment recorded.');
    }

    public function checkout(Request $request, CommerceService $commerce): RedirectResponse
    {
        $data = $request->validate([
            'client_id' => 'required|integer|exists:clients,id', 'method' => 'required|in:cash,card,transfer',
            'idempotency_key' => 'required|uuid', 'lines' => 'required|array|min:1|max:1000',
            'lines.*.product_id' => 'required|integer|distinct', 'lines.*.quantity' => 'required|integer|min:0|max:1000',
        ]);
        $lines = array_values(array_filter($data['lines'], fn (array $line): bool => (int) $line['quantity'] > 0));
        $invoice = $commerce->checkout(Client::findOrFail($data['client_id']), $lines, $data['method'], $data['idempotency_key'], $request->user());

        return redirect()->route('invoices.show', $invoice)->with('success', 'Sale recorded and stock updated. Payment is recorded locally; no card was charged.');
    }

    public function memberships(): View
    {
        return view('commerce.memberships', [
            'plans' => MembershipPlan::orderBy('name')->get(), 'clients' => Client::orderBy('name')->get(['id', 'name', 'email']),
            'memberships' => Membership::with(['client', 'plan', 'invoice', 'renewal'])->latest('id')->paginate(20),
        ]);
    }

    public function savePlan(Request $request, ?MembershipPlan $plan = null): RedirectResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120', Rule::unique('membership_plans')->ignore($plan)], 'benefits' => 'required|string|max:4000',
            'duration_days' => 'required|integer|min:1|max:1095', 'price_amount' => 'required|numeric|min:0.01|max:10000|decimal:0,2', 'active' => 'nullable|boolean',
        ]);
        $data['price'] = (int) round((float) $data['price_amount'] * 100);
        $data['active'] = $request->boolean('active');
        unset($data['price_amount']);
        ($plan ?? new MembershipPlan)->fill($data)->save();

        return redirect()->route('memberships.index')->with('success', 'Plan saved. Existing membership terms keep their purchased benefits and price.');
    }

    public function enrol(Request $request, CommerceService $commerce): RedirectResponse
    {
        $data = $request->validate([
            'client_id' => 'required|integer|exists:clients,id', 'membership_plan_id' => 'required|integer|exists:membership_plans,id',
            'starts_on' => 'required|date_format:Y-m-d', 'method' => 'required|in:cash,card,transfer', 'idempotency_key' => 'required|uuid',
        ]);
        $membership = $commerce->enrol(Client::findOrFail($data['client_id']), MembershipPlan::findOrFail($data['membership_plan_id']), $data['starts_on'], $data['method'], $data['idempotency_key']);

        return redirect()->route('invoices.show', $membership->invoice_id)->with('success', 'Membership term and payment recorded. No automatic charges or service credits are applied.');
    }

    public function renew(Request $request, Membership $membership, CommerceService $commerce): RedirectResponse
    {
        $data = $request->validate(['method' => 'required|in:cash,card,transfer', 'idempotency_key' => 'required|uuid']);
        $renewal = $commerce->renew($membership, $data['method'], $data['idempotency_key']);

        return redirect()->route('invoices.show', $renewal->invoice_id)->with('success', 'Renewal and payment recorded as a new membership term.');
    }
}
