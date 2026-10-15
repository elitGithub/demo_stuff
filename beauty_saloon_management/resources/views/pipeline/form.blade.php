<label>Enquiry title<input name="title" maxlength="160" required value="{{ old('title', $opportunity->title) }}" placeholder="For example, wedding party styling"></label>
<label>Type<select name="kind" required>@foreach (\App\Models\Opportunity::KINDS as $value => $label)<option value="{{ $value }}" @selected(old('kind', $opportunity->kind ?: 'enquiry') === $value)>{{ $label }}</option>@endforeach</select></label>
<label>Number of guests<input name="guest_count" type="number" min="1" max="500" required value="{{ old('guest_count', $opportunity->guest_count ?: 1) }}"></label>
<label>Requested event date<input name="event_date" type="date" value="{{ old('event_date', $opportunity->event_date?->format('Y-m-d')) }}"></label>
@if (auth()->user()->isManager())
    <label>Assigned team member<select name="assigned_to" required><option value="">Choose a team member</option>@foreach ($agents as $agent)<option value="{{ $agent->id }}" @selected((int) old('assigned_to', $opportunity->assigned_to ?: auth()->id()) === $agent->id)>{{ $agent->name }}</option>@endforeach</select></label>
@endif
<label>Next follow-up ({{ config('studio.timezone') }})<input name="next_follow_up_at" type="datetime-local" required value="{{ old('next_follow_up_at', $opportunity->next_follow_up_at?->setTimezone(config('studio.timezone'))->format('Y-m-d\TH:i') ?? now(config('studio.timezone'))->addDay()->format('Y-m-d\TH:i')) }}"></label>
<label style="grid-column:1 / -1">Next action<input name="next_action" maxlength="500" required value="{{ old('next_action', $opportunity->next_action) }}" placeholder="Call the organiser to confirm guest count"></label>
<label style="grid-column:1 / -1">Enquiry notes<textarea name="notes" maxlength="5000" rows="4">{{ old('notes', $opportunity->notes) }}</textarea></label>
