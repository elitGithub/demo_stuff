<form class="stack" action="{{ $stylist ? route('team.update', $stylist) : route('team.store') }}" method="post">
    @csrf @if ($stylist)
        @method('PUT')
    @endif
    <div class="form-grid">
        <label>Name<input name="name" value="{{ $stylist?->name }}" required maxlength="120"></label><label>Specialty /
            title<input name="title" value="{{ $stylist?->title }}" required maxlength="100"></label>
    </div><label>A little introduction
        <textarea name="bio" rows="2" maxlength="600">{{ $stylist?->bio }}</textarea>
    </label>
    <fieldset>
        <legend>Working days</legend>
        <div class="checkbox-row">
            @foreach (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as $day => $label)
                <label><input type="checkbox" name="working_days[]" value="{{ $day }}"
                        @checked(in_array($day, $stylist?->working_days ?? [1, 2, 3, 4, 5, 6]))>{{ $label }}</label>
            @endforeach
        </div>
    </fieldset>
    <div class="form-grid"><label>Start time<input type="time" name="start_time"
                value="{{ $stylist?->start_time ?? '09:00' }}" required></label><label>End time<input type="time"
                name="end_time" value="{{ $stylist?->end_time ?? '18:00' }}" required></label></div>
    <fieldset>
        <legend>Services offered</legend>
        <div class="checkbox-stack">
            @foreach ($services as $service)
                <label><input type="checkbox" name="service_ids[]" value="{{ $service->id }}"
                        @checked($stylist && $stylist->services->contains($service))>{{ $service->name }}</label>
            @endforeach
        </div>
    </fieldset><label class="checkbox-label"><input type="checkbox" name="active" value="1"
            @checked($stylist?->active ?? true)>Available for new bookings</label><label>Service commission (%)<input type="number" name="commission_rate" min="0" max="100" value="{{ $stylist?->commission_rate ?? 0 }}"><small class="field-help">Applies to new service invoices, excluding tax.</small></label><button class="button">Save team
        member</button>
</form>
