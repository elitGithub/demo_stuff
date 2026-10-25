@props(['title', 'message'])
<div class="empty-state">
    <span class="empty-symbol" aria-hidden="true">s</span>
    <h3>{{ $title }}</h3>
    <p>{{ $message }}</p>
    {{ $slot }}
</div>
