<form class="stack" action="{{ $product ? route('retail.products.update', $product) : route('retail.products.store') }}" method="post">
    @csrf @if ($product) @method('PUT') @endif
    <div class="form-grid">
        <label>Name<input name="name" value="{{ $product?->name }}" maxlength="120" required></label>
        <label>SKU<input name="sku" value="{{ $product?->sku }}" maxlength="60" required></label>
        <label>Price ({{ config('studio.currency') }})<input name="price_amount" type="number" min="0.01" max="10000" step="0.01" value="{{ $product ? number_format($product->price / 100, 2, '.', '') : '' }}" required></label>
    </div>
    <label>Description<textarea name="description" rows="2" maxlength="2000">{{ $product?->description }}</textarea></label>
    <label class="checkbox-label"><input type="checkbox" name="active" value="1" @checked($product?->active ?? true)>Available for sale</label>
    <button class="button">{{ $product ? 'Save product' : 'Add product' }}</button>
</form>
