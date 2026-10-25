@props(['title'])
@component('layouts.app', ['title' => $title])
    <div class="account-layout">
        <aside class="account-aside"><p class="eyebrow">YOUR NEXT GOOD HAIR DAY</p><h2>A space<br>for <em>your style.</em></h2><p>Find your people. Explore a new look. Make a little time for yourself.</p><img src="{{ asset('assets/seed/work-01.svg') }}" alt="Original illustrated hairstyle study" width="480" height="600"><a href="{{ route('discovery.index') }}">Meet the stylists <span aria-hidden="true">↗</span></a></aside>
        <section class="account-page">
        <p class="eyebrow">MAKE YOURSELF AT HOME</p>
        <h1>{{ $title }}</h1>
        <x-status />
        {{ $slot }}
        </section>
    </div>
@endcomponent
