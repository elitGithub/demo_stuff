<form class="stack" action="{{ $plan ? route('memberships.plans.update', $plan) : route('memberships.plans.store') }}" method="post">
    @csrf @if ($plan) @method('PUT') @endif
    <label>Plan name<input name="name" value="{{ $plan?->name }}" maxlength="120" required></label>
    <div class="form-grid">
        <label>Term (days)<input name="duration_days" type="number" min="1" max="1095" value="{{ $plan?->duration_days ?? 30 }}" required></label>
        <label>Price ({{ config('studio.currency') }})<input name="price_amount" type="number" min="0.01" max="10000" step="0.01" value="{{ $plan ? number_format($plan->price / 100, 2, '.', '') : '' }}" required></label>
    </div>
    <label>Included benefits<textarea name="benefits" rows="3" maxlength="4000" required>{{ $plan?->benefits }}</textarea></label>
    <p class="field-help">Describe the agreed benefits. The studio fulfils these manually; memberships do not apply discounts or service credits automatically.</p>
    <label class="checkbox-label"><input type="checkbox" name="active" value="1" @checked($plan?->active ?? true)>Available for enrolment and renewal</label>
    <button class="button">{{ $plan ? 'Save plan' : 'Add plan' }}</button>
</form>
