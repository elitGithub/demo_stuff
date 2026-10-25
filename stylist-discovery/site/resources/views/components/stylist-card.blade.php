@props(['profile'])
<article class="stylist-card">
    <a class="portrait" href="{{ route('stylists.show', $profile->id) }}" tabindex="-1" aria-hidden="true">
        @if($profile->portrait_asset)<img src="{{ asset('assets/seed/'.$profile->portrait_asset) }}" alt="" width="480" height="600" loading="lazy">@else<div class="portrait-placeholder">{{ mb_substr($profile->display_name, 0, 1) }}</div>@endif
        <span class="portrait-tag">{{ $profile->specialties->pluck('name')->join(' · ') }}</span>
    </a>
    <div class="card-info">
        <p class="city-label">{{ config('demo.locations.'.$profile->city_code.'.city') }}, {{ config('demo.locations.'.$profile->city_code.'.country') }}</p>
        <h3>{{ $profile->display_name }}</h3>
        <p class="studio-name">{{ $profile->studio_name }}</p>
        <div class="card-bottom"><p class="price"><small>From</small> €{{ number_format($profile->starting_price_cents / 100, 2) }}</p><a class="profile-link" href="{{ route('stylists.show', $profile->id) }}">View profile <span aria-hidden="true">↗</span><span class="visually-hidden"> of {{ $profile->display_name }}</span></a></div>
    </div>
</article>
