@php($editing = isset($proposal))
<form method="POST" action="{{ $editing ? route('quotes.update', $proposal) : route('quotes.store', $job) }}" class="stack">
    @csrf
    @if($editing) @method('PATCH')<input type="hidden" name="version" value="{{ $proposal->version }}"> @endif
    <div class="form-grid"><x-field name="amount" label="Your total price (USD)" :value="$editing ? intdiv($proposal->amount_cents, 100).'.'.str_pad((string) ($proposal->amount_cents % 100), 2, '0', STR_PAD_LEFT) : ''" inputmode="decimal" required placeholder="185.50" />
    <x-field name="available_date" label="When can you help?" type="date" :value="$editing ? $proposal->available_date->format('Y-m-d') : ''" :min="now(config('marketplace.timezone'))->toDateString()" required /></div>
    <x-field name="scope" label="What’s included?" required><textarea name="scope" id="scope" rows="4" maxlength="5000" required placeholder="Describe your approach, supplies, and what the customer can expect.">{{ old('scope', $editing ? $proposal->scope : '') }}</textarea></x-field>
    <p class="field-hint">Your price and scope become the agreement when the customer hires you.</p>
    <button type="submit" class="button primary">{{ $editing ? 'Update proposal' : 'Send your proposal' }}<x-icon name="arrow" /></button>
</form>
