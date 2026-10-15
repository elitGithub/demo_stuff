<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>@yield('title', 'Overview') · {{ config('studio.name') }}</title>
    <link rel="stylesheet" href="{{ asset('assets/studio.css') . '?v=' . filemtime(public_path('assets/studio.css')) }}">
    <script src="{{ asset('assets/studio.js') . '?v=' . filemtime(public_path('assets/studio.js')) }}" defer></script>
</head>

<body class="workspace"><a class="skip" href="#main">Skip to content</a>
    <aside class="sidebar" id="sidebar"><a class="brand"
            href="{{ route('dashboard') }}">{{ config('studio.name') }}<span>SALON & STUDIO</span></a>
        <div class="workspace-label"><span class="studio-mark">A</span>
            <div>Our studio<small>Management workspace</small></div><span class="tiny-dot"></span>
        </div>
        <div class="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
            @foreach ([['dashboard', 'grid', 'Overview', false], ['appointments.index', 'calendar', 'Appointments', false], ['clients.index', 'users', 'Clients', false], ['pipeline.index', 'arrow', 'Enquiries', false], ['services.index', 'scissors', 'Services', true], ['team.index', 'heart', 'Team', true], ['retail.index', 'bag', 'Retail & stock', true], ['memberships.index', 'heart', 'Memberships', true], ['invoices.index', 'file', 'Invoices', true], ['reports.index', 'chart', 'Sales reports', true], ['reminders.index', 'bell', 'Reminders', true], ['outreach.index', 'mail', 'Outreach', true], ['content.edit', 'globe', 'Website content', true]] as [$route, $icon, $label, $managerOnly])
                @if (!$managerOnly || auth()->user()->isManager())
                <a class="nav-link {{ request()->routeIs($route === 'dashboard' ? 'dashboard' : explode('.', $route)[0] . '.*') ? 'active' : '' }}" href="{{ route($route) }}">@include('components.icon', ['name' => $icon]) {{ $label }}</a>
                @endif
            @endforeach
            @can('manage-access')<a class="nav-link {{ request()->routeIs('access.*') ? 'active' : '' }}" href="{{ route('access.index') }}">@include('components.icon', ['name' => 'users']) Staff access</a>@endcan
        </nav>
        <div class="sidebar-bottom">@can('manage-studio')<a class="nav-link {{ request()->routeIs('settings') ? 'active' : '' }}"
                href="{{ route('settings') }}">@include('components.icon', ['name' => 'settings']) Studio settings</a>@endcan<a class="website-link"
                href="{{ route('home') }}" target="_blank">@include('components.icon', ['name' => 'globe']) View your website
                @include('components.icon', ['name' => 'arrow'])</a>
            <div class="profile"><span class="avatar dark">{{ mb_substr(auth()->user()->name, 0, 1) }}</span>
                <div><a href="{{ route('profile.edit') }}">{{ auth()->user()->name }}</a><small>{{ ucfirst(auth()->user()->role) }}</small></div>
                <form action="{{ route('logout') }}" method="post">@csrf<button class="icon-button" title="Sign out"
                        aria-label="Sign out">@include('components.icon', ['name' => 'logout'])</button></form>
            </div>
        </div>
    </aside>
    <div class="app-shell">
        <header class="topbar"><button class="icon-button mobile-menu" aria-label="Toggle navigation"
                aria-expanded="false" data-menu>@include('components.icon', ['name' => 'menu'])</button>
            <div class="breadcrumb">Workspace <span>/</span> <strong>@yield('title', 'Overview')</strong></div>
            <div class="topbar-actions"><a class="header-search"
                    href="{{ route('clients.index') }}">@include('components.icon', ['name' => 'search']) <span>Find a
                        client</span></a><span class="topbar-divider"></span>
                @if (config('studio.demo'))
                    <span class="demo-pill"><span class="dot"></span>Demo studio</span>
                @endif
                @can('manage-studio')<a class="icon-button" href="{{ route('reminders.index') }}"
                    aria-label="Reminders">@include('components.icon', ['name' => 'bell'])</a>@endcan
            </div>
        </header>
        <main id="main" class="main-content">
            @if (config('studio.public_demo'))
                <div class="notice" role="note"><div><strong>Browse-only demo.</strong> Explore the workspace and download sample invoices. Changes to shared data and staff settings are disabled.</div></div>
            @endif
            @include('components.notices') @yield('content')
        </main>
        <footer class="app-footer">{{ config('studio.name') }} <span>Thoughtful care. Beautiful
                business.</span><span>{{ now(config('studio.timezone'))->format('Y') }} ·
                {{ config('studio.currency') }}</span></footer>
    </div>@stack('scripts')
</body>

</html>
