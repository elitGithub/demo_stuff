@props(['case'])
<form id="reply-composer" class="reply-composer glass" method="POST" action="{{ route('cases.replies.store', $case) }}" data-pending data-draft-form>
    @csrf
    <div class="field">
        <label for="reply-body">Reply to {{ $case->sender_name ?? $case->sender_email }} <span class="required-mark" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
        <textarea id="reply-body" name="body" rows="4" maxlength="5000" data-original-value="" required aria-invalid="{{ $errors->has('body') ? 'true' : 'false' }}" aria-describedby="reply-hint{{ $errors->has('body') ? ' body-error' : '' }}">{{ is_string(old('body', '')) ? old('body', '') : '' }}</textarea>
        <p id="reply-hint" class="field-hint">Replies stay in the same Gmail thread. Up to 5,000 characters.</p>
        @error('body')<p id="body-error" class="field-error">{{ $message }}</p>@enderror
    </div>
    <div class="form-actions">
        <button type="submit" class="btn btn-primary"><x-icon name="send" /><span>Send via Gmail</span></button>
    </div>
</form>
