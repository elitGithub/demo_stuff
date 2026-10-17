@props(['title', 'icon' => 'inbox'])
<div {{ $attributes->class(['empty-state']) }}>
    <span class="empty-state-mark"><x-icon :name="$icon" /></span>
    <p class="empty-state-title">{{ $title }}</p>
    @if ($slot->hasActualContent())
        <p class="empty-state-body">{{ $slot }}</p>
    @endif
</div>
