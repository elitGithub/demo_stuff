@props(['title' => ''])
<!DOCTYPE html>
<html lang="en-CA">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <meta name="description" content="Casefile turns emails from the people you choose into cases you can track. A portfolio demonstration.">
    <title>{{ filled($title) ? $title.' · Casefile' : 'Casefile' }}</title>
    <x-theme-script />
    @fonts
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body>
    <a href="#main" class="skip-link">Skip to content</a>
    <header class="app-bar glass-nav">
        <a href="{{ url('/') }}" class="brand" aria-label="Casefile home" data-pending>
            <span class="brand-mark"><x-icon name="folder" /></span>
            <span>Casefile</span>
        </a>
        @auth
            <nav class="app-nav" aria-label="Main">
                @if (isset($nav) && $nav->hasActualContent())
                    {{ $nav }}
                @else
                    <a href="{{ route('home') }}" data-pending>Cases</a>
                @endif
                <a href="{{ route('search') }}" @if (request()->routeIs('search')) aria-current="page" @endif data-pending>Search</a>
                <a href="{{ route('inbox') }}" @if (request()->routeIs('inbox', 'inbox.show')) aria-current="page" @endif data-pending>Inbox</a>
                <a href="{{ route('settings') }}" @if (request()->routeIs('settings')) aria-current="page" @endif data-pending>Settings</a>
            </nav>
        @else
            @if (isset($nav) && $nav->hasActualContent())
                <nav class="app-nav" aria-label="Main">{{ $nav }}</nav>
            @endif
        @endauth
        @if (isset($actions) && $actions->hasActualContent())
            <div class="app-extra-actions">{{ $actions }}</div>
        @endif
        <div class="app-actions">
            @auth
                <x-layout-switcher :layout="$layout ?? null" />
            @endauth
            <x-theme-switcher />
            @auth
                <x-notification-bell />
            @endauth
        </div>
        <span id="theme-storage-notice" class="theme-storage-notice" data-theme-notice role="status" aria-live="polite"></span>
    </header>
    <x-demo-banner />
    <main id="main" class="app-main" tabindex="-1">
        <x-flash />
        {{ $slot }}
    </main>
    <x-toast :message="session('toast')" />
</body>
</html>
