@props(['profile'])
<a class="professional-card content-panel" href="{{ route('professionals.show', $profile) }}">
    <div class="professional-card-top"><span class="avatar avatar-large tone-{{ $profile->id % 4 }}">{{ mb_substr($profile->business_name, 0, 1) }}</span><span class="round-arrow"><x-icon name="arrow" /></span></div>
    <p class="eyebrow">{{ $profile->categories->pluck('name')->take(2)->join(' · ') }}</p>
    <h3>{{ $profile->business_name }}</h3>
    <p class="muted clamp-two">{{ $profile->bio }}</p>
    <div class="card-meta"><span><x-icon name="pin" />{{ implode(' · ', $profile->service_areas) }}</span>
        <span>@if($profile->user->received_reviews_count)<x-icon name="star" />{{ number_format($profile->user->received_reviews_avg_rating, 1) }} <small>({{ $profile->user->received_reviews_count }})</small>@else New on Haven @endif</span>
    </div>
</a>
