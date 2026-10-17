<x-public-layout :title="$profile->business_name">
    <a class="back-link" href="{{ route('professionals.index') }}">← All professionals</a>
    <section class="profile-hero content-panel">
        <span class="avatar avatar-xl tone-{{ $profile->id % 4 }}">{{ mb_substr($profile->business_name, 0, 1) }}</span>
        <div class="grow"><p class="eyebrow">MEET YOUR HELPING HAND</p><h1>{{ $profile->business_name }}</h1>
            <p class="card-meta"><span><x-icon name="pin" />{{ implode(' · ', $profile->service_areas) }}</span>
            @if($profile->user->received_reviews_count)<span><x-icon name="star" />{{ number_format($profile->user->received_reviews_avg_rating, 1) }} · {{ $profile->user->received_reviews_count }} reviews</span>@else<span>New on Haven</span>@endif</p>
        </div>
        <a class="button primary" href="{{ route('requests.create') }}">Post your project <x-icon name="arrow" /></a>
    </section>
    <div class="detail-grid section">
        <div class="stack"><article class="content-panel padded"><h2>A little about us</h2><p class="preserve-lines">{{ $profile->bio }}</p></article>
            <article class="content-panel padded"><div class="section-heading compact"><h2>Kind words from customers</h2><span>{{ $reviews->total() }} reviews</span></div>
                @forelse($reviews as $review)<article class="review"><div class="row-between"><strong>{{ \Illuminate\Support\Str::before($review->customer->name, ' ') }}</strong><span class="rating"><x-icon name="star" />{{ $review->rating }}/5</span></div><p>{{ $review->body }}</p><small>{{ $review->created_at->format('M j, Y') }}</small></article>@empty<p class="muted">A fresh start. Be part of this professional’s first chapter.</p>@endforelse
                {{ $reviews->links() }}
            </article>
        </div>
        <aside class="content-panel padded fit-content"><h3>What we can help with</h3><div class="tag-list">@foreach($profile->categories as $category)<span class="tag"><x-icon :name="$category->icon" />{{ $category->name }}</span>@endforeach</div><hr><h3>Our neighborhoods</h3>@foreach($profile->service_areas as $area)<p class="icon-line"><x-icon name="pin" />{{ $area }}</p>@endforeach</aside>
    </div>
</x-public-layout>
