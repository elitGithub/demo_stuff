<form class="stack" action="{{ $service ? route('services.update', $service) : route('services.store') }}" method="post">
    @csrf @if ($service)
        @method('PUT')
    @endif
    <div class="form-grid">
        <label>Name<input name="name" value="{{ $service?->name }}" maxlength="120"
                required></label><label>Category<input name="category" value="{{ $service?->category }}"
                placeholder="Hair, Colour, Care…" maxlength="60" required></label><label>Price
            ({{ config('studio.currency') }})<input name="price_amount" type="number" min="0" max="10000"
                step="0.01" value="{{ $service ? number_format($service->price / 100, 2, '.', '') : '' }}"
                required></label><label>Duration (minutes)<input name="duration" type="number" min="15"
                max="480" step="15" value="{{ $service?->duration ?? 45 }}" required></label>
    </div><label>Description
        <textarea name="description" rows="2" maxlength="500">{{ $service?->description }}</textarea>
    </label>
    <fieldset>
        <legend>Available with</legend>
        <div class="checkbox-row">
            @foreach ($stylists as $stylist)
                <label><input type="checkbox" name="stylist_ids[]" value="{{ $stylist->id }}"
                        @checked($service && $service->stylists->contains($stylist))>{{ $stylist->name }}</label>
            @endforeach
        </div>
    </fieldset><label class="checkbox-label"><input type="checkbox" name="active" value="1"
            @checked($service?->active ?? true)>Available for new bookings</label><button
        class="button">{{ $service ? 'Save service' : 'Add service' }}</button>
</form>
