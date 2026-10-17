@props(['case'])
@use('App\Enums\CaseStatus')
<form id="case-details" class="case-details-form" method="POST" action="{{ route('cases.update', $case) }}" tabindex="-1" data-pending data-draft-form>
    @csrf
    @method('PATCH')
    <h2 id="case-editor-heading" class="section-title">Manage case</h2>
    <div class="field">
        <label for="case-issue">Issue</label>
        <textarea id="case-issue" name="issue" rows="3" maxlength="5000" data-original-value="{{ $case->issue }}" aria-invalid="{{ $errors->has('issue') ? 'true' : 'false' }}" @if ($errors->has('issue')) aria-describedby="issue-error" @endif>{{ is_string(old('issue', $case->issue)) ? old('issue', $case->issue) : '' }}</textarea>
        @error('issue')<p id="issue-error" class="field-error">{{ $message }}</p>@enderror
    </div>
    <div class="field">
        <label for="case-status">Status <span class="required-mark" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
        <select id="case-status" name="status" required data-original-value="{{ $case->status->value }}" aria-invalid="{{ $errors->has('status') ? 'true' : 'false' }}" @if ($errors->has('status')) aria-describedby="status-error" @endif>
            @foreach (CaseStatus::cases() as $status)
                <option value="{{ $status->value }}" @selected(old('status', $case->status->value) === $status->value)>{{ $status->label() }}</option>
            @endforeach
        </select>
        @error('status')<p id="status-error" class="field-error">{{ $message }}</p>@enderror
    </div>
    <div class="field">
        <label for="case-notes">Notes</label>
        <textarea id="case-notes" name="notes" rows="4" maxlength="5000" data-original-value="{{ $case->notes }}" aria-invalid="{{ $errors->has('notes') ? 'true' : 'false' }}" @if ($errors->has('notes')) aria-describedby="notes-error" @endif>{{ is_string(old('notes', $case->notes)) ? old('notes', $case->notes) : '' }}</textarea>
        @error('notes')<p id="notes-error" class="field-error">{{ $message }}</p>@enderror
    </div>
    <div class="form-actions">
        <a href="{{ route('cases.show', $case) }}#case-details" class="btn btn-ghost" data-pending>Cancel</a>
        <button type="submit" class="btn btn-primary">Save</button>
    </div>
</form>
