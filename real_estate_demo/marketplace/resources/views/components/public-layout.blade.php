@props(['title' => 'Home services, handled', 'workspace' => false])
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#f5f4f1">
    <meta name="description" content="A little help. A lot more home. Discover Haven, a home-services marketplace portfolio demonstration.">
    <title>{{ $title }} · Haven</title>
    @fonts
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="{{ $workspace ? 'workspace-body' : 'public-body' }}">
    <a href="#main" class="skip-link">Skip to content</a>
    <header class="glass-nav site-header">
        <a href="{{ route('home') }}" class="brand" aria-label="Haven home"><span class="brand-mark"><x-icon name="home" /></span>haven<span class="brand-period">.</span></a>
        <button class="icon-button mobile-toggle" data-menu-toggle aria-expanded="false" aria-controls="site-menu" aria-label="Toggle navigation"><x-icon name="menu" /></button>
        <nav id="site-menu" class="site-menu" aria-label="Main navigation">
            <a href="{{ route('categories.index') }}" @class(['active' => request()->routeIs('categories.*')])>Services</a>
            <a href="{{ route('professionals.index') }}" @class(['active' => request()->routeIs('professionals.*')])>Find a professional</a>
            <a href="{{ route('home') }}#how-it-works">How it works</a>
            @auth<form class="mobile-sign-out" method="post" action="{{ route('logout') }}">@csrf<button class="text-button">Sign out</button></form>@endauth
            @guest<a class="mobile-sign-out" href="{{ route('login') }}">Sign in</a>@endguest
        </nav>
        <div class="header-actions">
            @auth
                <a href="{{ route('dashboard') }}" class="button dark small">My workspace <x-icon name="arrow" /></a>
            @else
                <a href="{{ route('login') }}" class="sign-in">Sign in</a>
                <a href="{{ route('register') }}" class="button dark small">Get started <x-icon name="arrow" /></a>
            @endauth
        </div>
    </header>
    <main id="main" class="{{ $workspace ? 'workspace-container' : 'public-container' }}">
        <x-flash />
        {{ $slot }}
    </main>
    <footer class="site-footer"><a href="{{ route('home') }}" class="brand">haven.</a><span>Good help. More room for life.</span><span>A purpose-built portfolio demonstration.</span></footer>
    <x-demo-banner />
</body>
</html>
