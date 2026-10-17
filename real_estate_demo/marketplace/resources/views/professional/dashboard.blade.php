<x-app-layout title="Your business at a glance">
    <div class="page-heading row-between"><div><p class="eyebrow">GOOD WORK STARTS HERE</p><h1>Hello, {{ \Illuminate\Support\Str::before(auth()->user()->name, ' ') }}.</h1><p>A clear view of your work, and what’s next.</p></div>
        @if(auth()->user()->profile?->status === \App\Enums\ProviderStatus::Approved)<a class="button primary" href="{{ route('opportunities.index') }}">Find your next job <x-icon name="arrow" /></a>@else<a class="button secondary" href="{{ route('profile.edit') }}">Complete your profile</a>@endif
    </div>
    @if(auth()->user()->profile?->status !== \App\Enums\ProviderStatus::Approved)<div class="flash"><strong>{{ auth()->user()->profile?->status === \App\Enums\ProviderStatus::Suspended ? 'Your profile is currently suspended.' : 'Your profile is awaiting approval.' }}</strong><p>You can review your history and keep your profile up to date.</p></div>@endif
    <div class="stat-grid">@foreach($stats as $label => $value)<article class="stat-card content-panel"><span>{{ $label }}</span><strong>{{ $value }}</strong><span class="stat-mark"><x-icon :name="['search', 'chat', 'wrench', 'check'][$loop->index]" /></span></article>@endforeach</div>
    <article class="content-panel padded simulated-summary"><div><p class="eyebrow">Simulated payments</p><h2>{{ \App\Support\Money::format($simulatedTotal) }}</h2></div><p class="muted">Demo receipts for your completed projects. No money was charged or transferred.</p></article>
    <div class="section-heading compact"><div><p class="eyebrow">YOUR CRAFT, AT WORK</p><h2>Your bookings</h2></div></div>
    <div class="stack">@forelse($jobs as $job)<x-job-card :job="$job" />@empty<x-empty-state title="Your next chapter starts with a proposal" description="When a customer chooses your quote, their project appears here." icon="wrench" />@endforelse</div>
    <div class="pagination">{{ $jobs->links() }}</div>
    <div class="section-heading compact"><h2>Recent proposals</h2></div>
    <div class="content-panel padded">@forelse($quotes as $quote)<a href="{{ route('requests.show', $quote->serviceRequest) }}" class="proposal-summary"><div><strong>{{ $quote->serviceRequest->title }}</strong><small>{{ $quote->serviceRequest->service_area }}</small></div><span>{{ \App\Support\Money::format($quote->amount_cents) }}</span><x-status-badge :status="$quote->status" /></a>@empty<p class="muted">Your proposals will appear here.</p>@endforelse</div>
</x-app-layout>
