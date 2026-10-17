@props(['attachment'])
<a href="{{ route('attachments.show', $attachment) }}" {{ $attributes->class(['attachment-chip']) }} target="_blank" rel="noopener">
    <x-icon name="paperclip" />
    <span class="attachment-chip-name">{{ $attachment->filename }}</span>
    <span class="sr-only">(opens in a new tab)</span>
</a>
