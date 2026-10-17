<x-app-layout title="Your conversations">
    <div class="page-heading"><p class="eyebrow">A GOOD CONVERSATION GOES A LONG WAY</p><h1>Let’s talk details.</h1><p>A private space for every proposal. Pick up a conversation below.</p></div>
    <div class="stack">@forelse($conversations as $quote)
        <a href="{{ route('conversations.show', $quote) }}" class="conversation-card content-panel"><span class="avatar tone-{{ $quote->provider_id % 4 }}">{{ mb_substr($quote->provider->profile->business_name, 0, 1) }}</span><div class="grow"><h3>{{ $quote->serviceRequest->title }}</h3><p>{{ auth()->id() === $quote->provider_id ? $quote->serviceRequest->customer->name : $quote->provider->profile->business_name }}</p><small>{{ $quote->messages_count }} {{ \Illuminate\Support\Str::plural('message', $quote->messages_count) }}</small></div><x-status-badge :status="$quote->status" /><x-icon name="arrow" /></a>
    @empty<x-empty-state title="Your conversations start with a proposal" description="Once a professional responds to a request, you can discuss the details here." icon="chat" />@endforelse</div>
    <div class="pagination">{{ $conversations->links() }}</div>
</x-app-layout>
