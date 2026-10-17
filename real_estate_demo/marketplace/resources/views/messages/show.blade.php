<x-app-layout title="A conversation about your project">
    <a class="back-link" href="{{ route('messages.index') }}">← All conversations</a>
    <div class="page-heading"><p class="eyebrow">THE LITTLE DETAILS MATTER</p><h1>{{ auth()->id() === $quote->provider_id ? $quote->serviceRequest->customer->name : $quote->provider->profile->business_name }}</h1><p>{{ $quote->serviceRequest->title }}</p></div>
    <section class="chat-panel content-panel">
        <div class="chat-header"><div><strong>{{ \App\Support\Money::format($quote->amount_cents) }}</strong><span>Proposal · {{ $quote->available_date->format('M j') }}</span></div><a class="text-link" href="{{ route('requests.show', $quote->serviceRequest) }}">View project <x-icon name="arrow" /></a></div>
        <div class="chat-history">
            @forelse($messages->getCollection()->reverse() as $message)
                <article @class(['chat-message', 'own' => $message->sender_id === auth()->id()])><small>{{ $message->sender_id === auth()->id() ? 'You' : $message->sender->name }}</small><p>{{ $message->body }}</p><time datetime="{{ $message->created_at->toIso8601String() }}">{{ $message->created_at->timezone(config('marketplace.timezone'))->format('M j · g:i a') }}</time></article>
            @empty<div class="chat-start"><x-icon name="chat" /><h3>A good place to start.</h3><p>Ask a question, share a detail, or say hello.</p></div>@endforelse
        </div>
        @if($messages->hasPages())<div class="padded">{{ $messages->links() }}</div>@endif
        @if($canSend)
            <form class="chat-composer" method="POST" action="{{ route('messages.store', $quote) }}">@csrf<label for="body">Your message</label><textarea name="body" id="body" rows="3" maxlength="2000" required placeholder="What would you like to know?">{{ old('body') }}</textarea>@error('body')<p class="field-error">{{ $message }}</p>@enderror<div class="row-between"><small>{{ config('demo.read_only') ? 'Read-only demo. Messages stay unchanged.' : 'Open this conversation again to see new replies.' }}</small><button class="button primary small" type="submit" @disabled(config('demo.read_only'))>Send message <x-icon name="arrow" /></button></div></form>
        @else<div class="chat-closed"><x-icon name="check" /><div><strong>This conversation is read-only.</strong><p>The project is closed, the proposal was declined, or the professional is unavailable. Your earlier messages are still here.</p></div></div>@endif
    </section>
</x-app-layout>
