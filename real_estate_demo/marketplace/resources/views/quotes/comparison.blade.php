<article class="quote-card content-panel padded">
    <div class="row-between"><div class="quote-person"><span class="avatar tone-{{ $quote->provider_id % 4 }}">{{ mb_substr($quote->provider->profile->business_name, 0, 1) }}</span><div><h3>{{ $quote->provider->profile->business_name }}</h3><small>@if($quote->provider->received_reviews_count){{ number_format($quote->provider->received_reviews_avg_rating, 1) }} / 5 · {{ $quote->provider->received_reviews_count }} {{ \Illuminate\Support\Str::plural('review', $quote->provider->received_reviews_count) }} @else New on Haven @endif</small></div></div><x-status-badge :status="$quote->status" /></div>
    <div class="quote-price-row"><strong>{{ \App\Support\Money::format($quote->amount_cents) }}</strong><span><x-icon name="calendar" />{{ $quote->available_date->format('M j, Y') }}</span></div>
    <p class="preserve-lines">{{ $quote->scope }}</p>
    <div class="quote-actions">
        @if(\Illuminate\Support\Facades\Route::has('conversations.show') && (auth()->id() === $quote->provider_id || auth()->id() === $job->customer_id))<a href="{{ route('conversations.show', $quote) }}" class="button secondary small"><x-icon name="chat" />Conversation</a>@endif
        @if(auth()->id() === $job->customer_id && $job->status === \App\Enums\JobStatus::Open && $quote->status === \App\Enums\QuoteStatus::Pending)
            <details class="hire-confirmation"><summary class="button primary small">Choose this professional <x-icon name="arrow" /></summary><div class="confirmation-summary"><h3>A good fit for your home?</h3><p>Hire {{ $quote->provider->profile->business_name }} for <strong>{{ \App\Support\Money::format($quote->amount_cents) }}</strong> on {{ $quote->available_date->format('M j') }}. This locks in the scope above and shares your address with this professional.</p><form method="POST" action="{{ route('quotes.accept', $quote) }}">@csrf<input type="hidden" name="version" value="{{ $quote->version }}"><button class="button primary" type="submit">Confirm and hire</button></form></div></details>
        @endif
    </div>
    @if(auth()->id() === $quote->provider_id && $job->status === \App\Enums\JobStatus::Open && $quote->status === \App\Enums\QuoteStatus::Pending && auth()->user()->can('quote', $job))
        <details class="edit-proposal"><summary>Revise your proposal</summary><div>@include('quotes.form', ['proposal' => $quote])</div></details>
    @endif
</article>
