@props(['message' => null])
<div class="toast surface" role="status" aria-live="polite" aria-atomic="true" data-toast @if (!is_string($message) || $message === '') hidden @endif>
    <x-icon name="check" />
    <p data-toast-message>{{ is_string($message) ? $message : '' }}</p>
    <button type="button" class="btn btn-ghost" data-toast-dismiss aria-label="Dismiss notification"><x-icon name="close" /></button>
</div>
