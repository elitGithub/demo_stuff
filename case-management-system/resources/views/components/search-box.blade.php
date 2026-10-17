@use('App\Enums\CaseStatus')
@props(['filters', 'senders'])
@php
    $text = old('q', $filters->text);
    $statuses = old('status', array_map(fn (CaseStatus $status): string => $status->value, $filters->statuses));
    $senderId = old('sender', $filters->trackedSenderId);
    $statusError = $errors->first('status') ?: $errors->first('status.*');
@endphp
<form method="GET" action="{{ route('search') }}" class="search-box surface" data-pending>
    <div class="field search-text">
        <label for="search-query">Keyword or case number</label>
        <input type="search" id="search-query" name="q" value="{{ is_string($text) ? $text : '' }}" maxlength="200" aria-invalid="{{ $errors->has('q') ? 'true' : 'false' }}" @if ($errors->has('q')) aria-describedby="q-error" @endif>
        @error('q')<p id="q-error" class="field-error">{{ $message }}</p>@enderror
    </div>
    <fieldset class="field search-statuses" @if ($statusError) aria-describedby="status-error" @endif>
        <legend>Status</legend>
        <div class="search-status-options">
            @foreach (CaseStatus::cases() as $status)
                <label for="search-status-{{ $status->value }}">
                    <input type="checkbox" id="search-status-{{ $status->value }}" name="status[]" value="{{ $status->value }}" @checked(is_array($statuses) && in_array($status->value, $statuses, true)) aria-invalid="{{ $statusError ? 'true' : 'false' }}">
                    <span>{{ $status->label() }}</span>
                </label>
            @endforeach
        </div>
        @if ($statusError)<p id="status-error" class="field-error">{{ $statusError }}</p>@endif
        <p class="field-hint">Leave all unchecked to include every status.</p>
    </fieldset>
    <div class="field">
        <label for="search-sender">Sender</label>
        <select id="search-sender" name="sender" aria-invalid="{{ $errors->has('sender') ? 'true' : 'false' }}" @if ($errors->has('sender')) aria-describedby="sender-error" @endif>
            <option value="">All senders</option>
            @foreach ($senders as $sender)
                <option value="{{ $sender->id }}" @selected((is_string($senderId) || is_int($senderId)) && (string) $senderId === (string) $sender->id)>{{ $sender->name }} · {{ $sender->email }}{{ $sender->is_active ? '' : ' (inactive)' }}</option>
            @endforeach
        </select>
        @error('sender')<p id="sender-error" class="field-error">{{ $message }}</p>@enderror
    </div>
    <div class="search-dates">
        @foreach (['from' => 'Received from', 'to' => 'Received through'] as $field => $label)
            @php($date = old($field, $filters->{$field}?->toDateString()))
            <div class="field">
                <label for="search-{{ $field }}">{{ $label }}</label>
                <input type="date" id="search-{{ $field }}" name="{{ $field }}" value="{{ is_string($date) ? $date : '' }}" aria-invalid="{{ $errors->has($field) ? 'true' : 'false' }}" @if ($errors->has($field)) aria-describedby="{{ $field }}-error" @endif>
                @error($field)<p id="{{ $field }}-error" class="field-error">{{ $message }}</p>@enderror
            </div>
        @endforeach
    </div>
    @error('page')<p class="field-error">{{ $message }}</p>@enderror
    <div class="form-actions search-actions">
        <a href="{{ route('search') }}" class="btn btn-ghost" data-pending>Clear filters</a>
        <button type="submit" class="btn btn-primary">Search</button>
    </div>
</form>
