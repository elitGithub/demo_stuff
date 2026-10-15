@extends('layouts.app')
@section('title', 'Retail & stock')
@section('content')
<div class="page-heading">
    <div><span class="eyebrow">CARE TO TAKE HOME</span><h1>Retail & stock.</h1><p>A clear catalogue, a reliable stock history, and one receipt for every sale.</p></div>
    <a class="button secondary" href="{{ route('memberships.index') }}">Memberships</a>
</div>
<section class="panel mb">
    <h2>Record a sale</h2>
    <p class="muted">Choose a client and quantities. Prices come from the catalogue. Recording payment does not charge a card.</p>
    @if ($products->where('active', true)->isNotEmpty() && $clients->isNotEmpty())
    <form class="stack" method="post" action="{{ route('retail.checkout') }}">
        @csrf
        <input type="hidden" name="idempotency_key" value="{{ old('idempotency_key', (string) \Illuminate\Support\Str::uuid()) }}">
        <div class="form-grid"><label>Client<select name="client_id" required><option value="">Choose a client</option>@foreach ($clients as $client)<option value="{{ $client->id }}" @selected(old('client_id') == $client->id)>{{ $client->name }}{{ $client->email ? ' · '.$client->email : '' }}</option>@endforeach</select></label>@include('commerce.payment-method')</div>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Unit price</th><th>In stock</th><th>Quantity</th></tr></thead><tbody>
        @foreach ($products->where('active', true)->values() as $index => $product)
            <tr><td><strong>{{ $product->name }}</strong><div class="muted">{{ $product->sku }}</div><input type="hidden" name="lines[{{ $index }}][product_id]" value="{{ $product->id }}"></td><td>{{ \App\Support\Money::format($product->price) }}</td><td>{{ $product->stock }}</td><td><input aria-label="Quantity of {{ $product->name }}" name="lines[{{ $index }}][quantity]" type="number" min="0" max="{{ min(1000, $product->stock) }}" value="{{ old('lines.'.$index.'.quantity', 0) }}" required></td></tr>
        @endforeach
        </tbody></table></div>
        <p class="field-help">Leave unused products at zero. {{ config('studio.tax_percent') }}% tax is added at checkout.</p>
        <button class="button">Record paid sale</button>
    </form>
    @else <p class="muted">Add a product and a client before recording a sale. <a href="{{ route('clients.index') }}">Open clients</a></p> @endif
</section>
<section class="panel mb"><details class="edit-details"><summary>Add a product <span>+</span></summary><div class="mt">@include('commerce.product-form', ['product' => null])</div></details></section>
<div class="catalogue-grid mb">
    @forelse ($products as $product)
    <article class="panel">
        <div class="service-category">{{ $product->sku }} <span class="badge {{ $product->active ? 'confirmed' : 'cancelled' }}">{{ $product->active ? 'Available' : 'Archived' }}</span></div>
        <h2 class="mt">{{ $product->name }}</h2><p class="muted">{{ $product->description }}</p>
        <div class="service-metrics"><strong>{{ \App\Support\Money::format($product->price) }}</strong><span>{{ $product->stock }} in stock</span></div>
        <details class="edit-details"><summary>Adjust stock <span>+</span></summary><form class="stack mt" action="{{ route('retail.stock', $product) }}" method="post">@csrf<label>Units to add or remove<input name="quantity" type="number" min="-100000" max="100000" placeholder="e.g. 12 or -2" required></label><label>Reason<input name="reason" maxlength="255" placeholder="Delivery, damaged goods, stock count…" required></label><button class="button secondary">Record adjustment</button></form></details>
        <details class="edit-details"><summary>Edit product <span>+</span></summary><div class="mt">@include('commerce.product-form')</div></details>
    </article>
    @empty <section class="panel"><p class="muted">Your retail catalogue is ready for its first product.</p></section> @endforelse
</div>
<section class="panel mb"><h2>Recent sales</h2><div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Total</th><th>Status</th></tr></thead><tbody>
@forelse ($sales as $sale)<tr><td><a href="{{ route('invoices.show', $sale) }}">{{ $sale->number }}</a></td><td>{{ $sale->client_name }}</td><td>{{ $sale->issued_at->timezone(config('studio.timezone'))->format('M j, Y') }}</td><td>{{ \App\Support\Money::format($sale->total, $sale->currency) }}</td><td>{{ ucfirst($sale->status) }}</td></tr>@empty<tr><td colspan="5" class="muted">No retail sales recorded yet.</td></tr>@endforelse
</tbody></table></div>@include('components.pagination', ['records' => $sales])</section>
<section class="panel"><h2>Stock history</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Change</th><th>Balance</th><th>Reason</th><th>Recorded by</th></tr></thead><tbody>
@forelse ($movements as $movement)<tr><td>{{ $movement->created_at->timezone(config('studio.timezone'))->format('M j, H:i') }}</td><td>{{ $movement->product->name }}</td><td>{{ $movement->quantity > 0 ? '+' : '' }}{{ $movement->quantity }}</td><td>{{ $movement->balance }}</td><td>@if ($movement->invoice)<a href="{{ route('invoices.show', $movement->invoice) }}">{{ $movement->reason }}</a>@else{{ $movement->reason }}@endif</td><td>{{ $movement->user?->name ?? 'Studio' }}</td></tr>@empty<tr><td colspan="6" class="muted">Every stock adjustment and sale will appear here.</td></tr>@endforelse
</tbody></table></div>@include('components.pagination', ['records' => $movements])</section>
@endsection
