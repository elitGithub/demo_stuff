@props(['name' => 'home'])
@php
$paths = [
    'receipt' => '<path d="M6 9V3h12v6M6 17H3V9h18v8h-3"/><path d="M6 14h12v7H6z"/><path d="M17 11h1"/>',
    'lock' => '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    'home' => '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
    'sparkles' => '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7Z"/>',
    'pipe' => '<path d="M4 4h7v7h9v7H8a4 4 0 0 1-4-4Z"/><path d="M2 4h11M20 9v11M4 8h7"/>',
    'bolt' => '<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
    'brush' => '<rect x="3" y="3" width="14" height="6" rx="2"/><path d="M17 6h3v7h-8v3"/><rect x="10" y="16" width="4" height="6" rx="1"/>',
    'leaf' => '<path d="M20 3c1 11-1 16-8 16a7 7 0 0 1-7-7c0-7 7-7 15-9Z"/><path d="M3 22 15 10"/>',
    'wrench' => '<path d="M14 4a6 6 0 0 0-7 7L2 16a3 3 0 0 0 6 6l6-7a6 6 0 0 0 7-7l-5 3-3-3Z"/>',
    'arrow' => '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    'check' => '<path d="m5 12 4 4L19 6"/>',
    'pin' => '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    'star' => '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9Z"/>',
    'chat' => '<path d="M21 11a9 9 0 0 1-9 9H3l1.8-4.3A9 9 0 1 1 21 11Z"/><path d="M8 10h8m-8 4h5"/>',
    'grid' => '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    'bell' => '<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10ZM9 21h6"/>',
    'user' => '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    'calendar' => '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6m10-6v6M3 11h18"/>',
    'plus' => '<path d="M12 5v14M5 12h14"/>',
    'search' => '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    'menu' => '<path d="M4 6h16M4 12h16M4 18h16"/>',
];
@endphp
<svg {{ $attributes->class(['icon']) }} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{!! $paths[$name] ?? $paths['home'] !!}</svg>
