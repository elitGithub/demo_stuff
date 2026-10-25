@component('layouts.app', ['title' => 'Your availability'])
    <a class="back-link" href="{{ route('stylist.onboarding') }}">← Your studio checklist</a>
    <section class="studio-menu-heading"><div><p class="eyebrow">03 / YOUR TIME</p><h1>Make room.<br><em>For good things.</em></h1><p>Set a rhythm for your studio and protect the time you need.</p></div><span class="timezone-badge">{{ $profile->timezone }}</span></section>
    <div id="save-result" tabindex="-1" data-save-result>@if(session('availability_target') !== 'time-off')<x-status />@if(session('status'))<div class="saved-next"><a href="{{ route('stylist.onboarding') }}#review">Continue to your studio checklist <span aria-hidden="true">→</span></a></div>@endif @endif</div>
    @php($timeOffErrors = request()->routeIs('stylist.time-off.store', 'stylist.time-off.destroy'))
    @if(!$timeOffErrors)<x-field-errors :errors="$errors" />@endif
    @foreach($errors->keys() as $errorKey)
        @if(!$timeOffErrors && str_starts_with($errorKey, 'booking.') && \Illuminate\Support\Facades\Route::has('bookings.show'))<a class="text-link" href="{{ route('bookings.show', (int) substr($errorKey, 8)) }}">Review booking #{{ (int) substr($errorKey, 8) }} →</a>@endif
    @endforeach
    <div class="schedule-layout">
        <section class="studio-editor"><form action="{{ route('stylist.availability.update') }}" method="post" class="account-form studio-form" data-loading-form>
            @csrf @method('patch') <x-actor-context />
            <div class="studio-form-heading"><h2>Your weekly rhythm</h2><p>All times are local to {{ config('demo.locations.'.$profile->city_code.'.city') }}. Open on a 15-minute interval; close later that day. Uncheck a day to keep it closed.</p></div>
            <div class="weekly-schedule">
                @foreach([1 => 'Monday', 2 => 'Tuesday', 3 => 'Wednesday', 4 => 'Thursday', 5 => 'Friday', 6 => 'Saturday', 0 => 'Sunday'] as $weekday => $dayName)
                    @php($dayIndex = $loop->index)
                    @php($saved = $hours->get($weekday))
                    @php($dayValues = $values['days'][$dayIndex] ?? null)
                    <fieldset class="schedule-day"><legend>{{ $dayName }}</legend>
                        <input type="hidden" name="days[{{ $dayIndex }}][weekday]" value="{{ $weekday }}">
                        <input type="hidden" name="days[{{ $dayIndex }}][open]" value="0">
                        <label class="schedule-open"><input type="checkbox" name="days[{{ $dayIndex }}][open]" value="1" @checked($dayValues !== null ? $dayValues['open'] === '1' : $saved !== null)> Open</label>
                        <div class="schedule-times"><div class="form-field"><label for="opens-{{ $weekday }}">Opens <span aria-hidden="true">*</span></label><input id="opens-{{ $weekday }}" type="time" name="days[{{ $dayIndex }}][opens_at]" step="900" value="{{ $dayValues['opens_at'] ?? $saved?->opens_at ?? config('demo.seed.hours.opens_at') }}"></div><span aria-hidden="true">—</span><div class="form-field"><label for="closes-{{ $weekday }}">Closes <span aria-hidden="true">*</span></label><input id="closes-{{ $weekday }}" type="time" name="days[{{ $dayIndex }}][closes_at]" value="{{ $dayValues['closes_at'] ?? $saved?->closes_at ?? config('demo.seed.hours.closes_at') }}"></div></div>
                    </fieldset>
                @endforeach
            </div>
            <p class="schedule-hint">Accepted and confirmed visits stay protected. If a change conflicts, review the affected appointment first.</p>
            <div class="form-actions"><a class="secondary-button" href="{{ route('stylist.onboarding') }}">Cancel</a><x-loading-button label="Save weekly hours" progress="Saving your hours…" /></div>
        </form></section>
        <aside class="time-off-panel" id="time-off" tabindex="-1">@if(session('availability_target') === 'time-off')<x-status />@endif @if($timeOffErrors)<x-field-errors :errors="$errors" />@foreach($errors->keys() as $errorKey) @if(str_starts_with($errorKey, 'booking.') && \Illuminate\Support\Facades\Route::has('bookings.show'))<a class="text-link" href="{{ route('bookings.show', (int) substr($errorKey, 8)) }}">Review booking #{{ (int) substr($errorKey, 8) }} →</a>@endif @endforeach @endif<p class="eyebrow">A LITTLE BREATHING ROOM</p><h2>Time away.</h2><p>Block a break, a day off or a longer pause. Existing accepted visits stay protected.</p>
            <form action="{{ route('stylist.time-off.store') }}" method="post" class="account-form" data-loading-form>@csrf<x-actor-context />
                <div class="form-field"><label for="starts_local">From <span aria-hidden="true">*</span></label><input id="starts_local" name="starts_local" type="datetime-local" required value="{{ str_replace(' ', 'T', $values['starts_local'] ?? '') }}"><x-field-errors field="starts_local" :errors="$errors" /></div>
                <div class="form-field"><label for="ends_local">Until <span aria-hidden="true">*</span></label><input id="ends_local" name="ends_local" type="datetime-local" required value="{{ str_replace(' ', 'T', $values['ends_local'] ?? '') }}"><x-field-errors field="ends_local" :errors="$errors" /></div>
                <x-loading-button label="Add time off" progress="Saving time off…" />
            </form>
            <div class="time-off-heading"><h3>Your time off</h3><span>{{ $timeOff->total() }} saved</span></div>
            <div class="time-off-list">@forelse($timeOff as $interval)<article><p><strong>{{ $interval->starts_at->setTimezone($profile->timezone)->format('d M Y, H:i') }}</strong><br>to {{ $interval->ends_at->setTimezone($profile->timezone)->format('d M Y, H:i') }}</p><form action="{{ route('stylist.time-off.destroy', $interval->id) }}" method="post" data-loading-form data-confirm="Remove this time off?">@csrf @method('delete')<x-actor-context /><x-loading-button label="Remove" progress="Removing…" /></form></article>@empty<p class="schedule-hint">No time off saved. Your weekly hours guide availability.</p>@endforelse</div>
            <x-pagination :paginator="$timeOff" fragment="time-off" label="Your time off" />
        </aside>
    </div>
@endcomponent
