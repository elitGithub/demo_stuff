<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title', 'Hair, with a little more care') · {{ config('studio.name') }}</title>
    <meta name="description"
        content="{{ config('studio.hero_subtitle', 'Thoughtful cuts, beautiful colour and a little time for yourself.') }}">
    <link rel="stylesheet" href="{{ asset('assets/studio.css') . '?v=' . filemtime(public_path('assets/studio.css')) }}">
    <script src="{{ asset('assets/studio.js') . '?v=' . filemtime(public_path('assets/studio.js')) }}" defer></script>
</head>

<body class="public-site"><a class="skip" href="#main">Skip to content</a>
    <header class="public-header"><a class="brand" href="{{ route('home') }}">{{ config('studio.name') }}<span>SALON &
                STUDIO</span></a>
        <nav><a href="{{ route('home') }}#services">Our services</a><a href="{{ route('home') }}#team">The people</a><a href="{{ route('home') }}#about">Our studio</a><a
                href="{{ route('login') }}" class="staff-link">Studio login</a><a href="{{ route('booking.create') }}"
                class="button small">Book a visit @include('components.icon', ['name' => 'arrow'])</a></nav>
    </header>
    <main id="main">
        @if (config('studio.public_demo'))
            <div class="notice" role="note"><div><strong>Browse-only demo.</strong> Explore the website and workspace with fictional data. Changes, bookings and message submissions are disabled.</div></div>
        @endif
        @if (session('success'))<div class="notice" role="status">{{ session('success') }}</div>@endif
        @if ($errors->any())<div class="notice" role="alert"><strong>Please check the form.</strong><ul>@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul></div>@endif
        @yield('content')
    </main>
    <footer class="public-footer">
        <div><a class="brand" href="{{ route('home') }}">{{ config('studio.name') }}</a>
            <p>A little time for yourself.</p>
        </div>
        <div>{{ config('studio.address') }}<br>{{ config('studio.phone') }}<br>{{ config('studio.contact_email', 'hello@atelier.example') }}</div>
        <div><a href="{{ route('login') }}">Studio workspace ↗</a><small>
                @if (config('studio.demo'))
                    A fictional salon, a working demo.@else{{ now()->year }} {{ config('studio.name') }}
                @endif
            </small></div>
    </footer>@stack('scripts')
</body>

</html>
