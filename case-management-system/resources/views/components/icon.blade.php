@props(['name'])
@php
    $paths = [
        'appearance' => '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
        'workspace' => '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        'chevron' => '<path d="m6 9 6 6 6-6"/>',
        'system' => '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
        'sun' => '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
        'moon' => '<path d="M20.4 13A8.5 8.5 0 0 1 11 3.6 8.5 8.5 0 1 0 20.4 13Z"/>',
        'reset' => '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
        'signout' => '<path d="M9 4H4v16h5m5-12 4 4-4 4M8 12h10"/>',
        'alert' => '<path d="M12 3.5 2.5 20h19Z"/><path d="M12 10v4.5M12 17.5h.01"/>',
        'arrow' => '<path d="M4 12h15m-6-6 6 6-6 6"/>',
        'bell' => '<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10ZM9 21h6"/>',
        'check' => '<path d="m5 12 4 4L19 6"/>',
        'close' => '<path d="M6 6l12 12M18 6 6 18"/>',
        'folder' => '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
        'inbox' => '<path d="M3 13h5l1.5 3h5l1.5-3h5"/><path d="M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5Z"/>',
        'info' => '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
        'mail' => '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
        'paperclip' => '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7"/>',
        'plus' => '<path d="M12 5v14M5 12h14"/>',
        'search' => '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
        'send' => '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4Z"/>',
        'user' => '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    ];

    if (! array_key_exists($name, $paths)) {
        throw new \InvalidArgumentException("Unknown icon [{$name}].");
    }
@endphp
<svg {{ $attributes->class(['icon']) }} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{!! $paths[$name] !!}</svg>
