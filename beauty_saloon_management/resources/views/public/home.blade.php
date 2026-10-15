@extends('layouts.public')
@section('content')
    <section class="hero">
        <div class="hero-copy"><span class="eyebrow"><span class="line"></span> MADE FOR YOU, EVERY TIME</span>
            <h1>{{ config('studio.hero_title', 'Good hair. Great energy.') }}</h1>
            <p>{{ config('studio.hero_subtitle', 'Your style, your moment. Thoughtful cuts, beautiful colour and a team that remembers the little things.') }}</p>
            <div class="hero-actions"><a href="{{ route('booking.create') }}" class="button">Find your next appointment
                    @include('components.icon', ['name' => 'arrow'])</a><a href="#services" class="text-link">Explore our services</a></div>
            <div class="hero-note"><span class="mini-avatars"><i>AM</i><i>MB</i><i>LS</i></span><span>Good hands. Familiar
                    faces.<br><strong>A little more care, every visit.</strong></span></div>
        </div>
        <div class="hero-image"><img src="{{ asset('assets/salon-hero.jpg') }}"
                alt="A stylist carefully finishing a haircut in the studio"><span class="image-caption">A fresh
                perspective.<br><em>A familiar feeling.</em></span><span
                class="image-stamp">THE<br>{{ mb_strtoupper(config('studio.name')) }}<br>EXPERIENCE</span></div>
    </section>
    <div class="values-strip"><span>@include('components.icon', ['name' => 'scissors']) Craft over trends</span><span>@include('components.icon', ['name' => 'heart'])
            Your style, remembered</span><span>@include('components.icon', ['name' => 'calendar']) Time that works for you</span></div>
    <section class="public-section" id="services">
        <div class="section-heading">
            <div><span class="eyebrow">THE SERVICE MENU</span>
                <h2>Small details.<br>Beautiful difference.</h2>
            </div>
            <p>From a quick refresh to a whole new chapter.<br>Every visit starts with a conversation.</p>
        </div>
        <div class="service-grid">
            @foreach ($services as $service)
                <a class="service-card" href="{{ route('booking.create', ['service' => $service->id]) }}">
                    <div class="service-category">{{ $service->category }} <span>{{ $service->duration }} min</span></div>
                    <h3>{{ $service->name }}</h3>
                    <p>{{ $service->description }}</p>
                    <div class="service-bottom"><strong>{{ \App\Support\Money::format($service->price) }}</strong><span
                            class="circle-arrow">↗</span></div>
                </a>
            @endforeach
        </div>
    </section>
    <section class="team-section" id="team">
        <div class="section-heading">
            <div><span class="eyebrow">THE PEOPLE BEHIND THE CHAIR</span>
                <h2>Find your person.</h2>
            </div>
            <p>Different specialties. One shared belief:<br>you should leave feeling like yourself.</p>
        </div>
        <div class="team-grid">
            @foreach ($stylists as $stylist)
                <article class="team-card">
                    <div class="team-portrait portrait-{{ $loop->index }}">
                        <span>{{ collect(explode(' ', $stylist->name))->map(fn($n) => mb_substr($n, 0, 1))->implode('') }}</span><small>{{ mb_strtoupper(config('studio.name')) }}
                            / {{ str_pad($loop->iteration, 2, '0', STR_PAD_LEFT) }}</small></div>
                    <h3>{{ $stylist->name }}</h3><span class="muted">{{ $stylist->title }}</span>
                    <p>{{ $stylist->bio }}</p><a class="text-link"
                        href="{{ route('booking.create', ['stylist' => $stylist->id]) }}">Book with
                        {{ explode(' ', $stylist->name)[0] }} ↗</a>
                </article>
            @endforeach
        </div>
    </section>
    <section class="public-section" id="about">
        <div class="section-heading"><div><span class="eyebrow">OUR STUDIO</span><h2>{{ config('studio.about_title', 'A little more care, every visit.') }}</h2></div><p style="white-space: pre-wrap">{{ config('studio.about_body', 'Our studio is a place to feel at home. We take the time to listen, remember the details and create a look that feels like you.') }}</p></div>
        <div class="service-grid">
            <section class="service-card"><h3>Come say hello.</h3><p style="white-space: pre-wrap">{{ config('studio.address') }}</p><p>{{ config('studio.phone') }}<br>{{ config('studio.contact_email', 'hello@atelier.example') }}</p><p>{{ config('studio.opening_hours', 'Monday–Saturday · 09:00–19:00') }}</p></section>
            <form class="service-card stack" action="{{ route('newsletter.subscribe') }}" method="post">
                @csrf<h3>A little studio news.</h3><p>Occasional news and inspiration from the studio.</p><label>Email address<input name="email" type="email" required maxlength="200" value="{{ old('email') }}" autocomplete="email"></label>
                <label class="checkbox-label"><input type="checkbox" name="consent" value="1" required> I agree to receive studio newsletters by email. I can unsubscribe at any time.</label>
                <p class="field-help">This demo records your preference and creates previews. No emails are sent.</p><button class="button">Join the newsletter</button>
            </form>
        </div>
    </section>
    <section class="booking-banner"><span class="eyebrow">YOUR CHAIR IS WAITING</span>
        <h2>Make a little time<br><em>for a fresh start.</em></h2><a class="button light"
            href="{{ route('booking.create') }}">Let's find your time @include('components.icon', ['name' => 'arrow'])</a>
    </section>
@endsection
