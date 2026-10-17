<x-app-layout title="Your home, handled">
    <div class="page-heading row-between"><div><p class="eyebrow">A LITTLE LESS ON YOUR LIST</p><h1>Welcome home, {{ \Illuminate\Support\Str::before(auth()->user()->name, ' ') }}.</h1><p>Here’s what’s happening around your home.</p></div><a class="button primary" href="{{ route('requests.create') }}"><x-icon name="plus" />New request</a></div>
    <div class="stat-grid">@foreach($stats as $label => $value)<article class="stat-card content-panel"><span>{{ $label }}</span><strong>{{ $value }}</strong><span class="stat-mark"><x-icon :name="['home', 'chat', 'wrench', 'check'][$loop->index]" /></span></article>@endforeach</div>
    <div class="section-heading compact"><div><p class="eyebrow">FROM TO-DO TO TA-DA</p><h2>Your projects</h2></div><span>{{ $jobs->total() }} in your home</span></div>
    <div class="stack">@forelse($jobs as $job)<x-job-card :job="$job" />@empty<x-empty-state title="A fresh page for your home" description="A dripping tap, a room to refresh, or a garden that needs love. Start with one request."><a class="button primary" href="{{ route('requests.create') }}">Post your first request <x-icon name="arrow" /></a></x-empty-state>@endforelse</div>
    <div class="pagination">{{ $jobs->links() }}</div>
</x-app-layout>
