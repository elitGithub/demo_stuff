@props(['label' => 'Save', 'progress' => 'Saving…'])
<button type="submit" class="button">{{ $label }}</button>
<p class="form-progress" role="status" aria-live="polite" data-loading-status hidden>{{ $progress }}</p>
