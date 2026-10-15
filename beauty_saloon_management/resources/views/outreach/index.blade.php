@extends('layouts.app')
@section('title', 'Outreach')
@section('content')
    <div class="page-heading">
        <div><span class="eyebrow">THOUGHTFUL CONNECTIONS</span><h1>Outreach</h1><p>Birthday wishes, anniversaries and studio news, with permission.</p></div>
        <a class="button secondary" href="{{ route('content.edit') }}">Edit website text ↗</a>
    </div>
    <div class="notice"><strong>Preview mode.</strong> Every message stays in this workspace. Simulation checks consent again and records the result; nothing is sent.</div>
    <div class="detail-grid mt">
        <div class="stack">
            <section class="panel">
                <div class="panel-heading"><h2>Message previews</h2><span class="badge">{{ $pendingCount }} pending</span></div>
                <div class="action-row">
                    <form action="{{ route('outreach.generate') }}" method="post">@csrf<button class="button secondary">Create today's occasion previews</button></form>
                    <form action="{{ route('outreach.process') }}" method="post">@csrf<button class="button">Simulate pending previews</button></form>
                </div>
                <p class="field-help">Occasions are matched to today's date in {{ config('studio.timezone') }}. One preview per client, channel and occasion each year. February 29 dates run only in leap years. Missed occasion dates are cancelled.</p>
                @forelse ($messages as $message)
                    <article class="note">
                        <div class="spread"><strong>{{ $message->subject }}</strong><span class="badge">{{ ucfirst($message->status) }}</span></div>
                        <p class="muted">{{ $message->recipient }} · {{ strtoupper($message->channel) }} · {{ ucfirst($message->kind) }} · {{ $message->due_date->format('M j, Y') }}</p>
                        <p style="white-space: pre-wrap">{{ $message->body }}</p>
                        @if ($message->subscriber)
                            <a class="text-link" href="{{ route('newsletter.unsubscribe', $message->subscriber->unsubscribe_token) }}">Preview unsubscribe page ↗</a>
                        @elseif ($message->client)
                            <a class="text-link" href="{{ route('clients.show', $message->client) }}">Manage client consent ↗</a>
                        @endif
                    </article>
                @empty
                    <div class="empty-state"><h3>A little care starts with permission.</h3><p>Add client dates and marketing consent, then create today's previews.</p></div>
                @endforelse
                {{ $messages->links() }}
            </section>
            <section class="panel">
                <div class="panel-heading"><h2>Newsletter audience</h2><span class="muted">{{ $audienceCount }} subscribed</span></div>
                <p class="field-help">People join through the public website with explicit consent. Opt-outs stay recorded and anonymous signups cannot reactivate them.</p>
                @forelse ($subscribers as $subscriber)
                    <div class="line-item">
                        <div><strong>{{ $subscriber->email }}</strong><small>{{ $subscriber->unsubscribed_at ? 'Opted out '.$subscriber->unsubscribed_at->format('M j, Y') : 'Consented '.$subscriber->consented_at->format('M j, Y') }}</small></div>
                        @if (! $subscriber->unsubscribed_at)
                            <form action="{{ route('outreach.suppress', $subscriber) }}" method="post">@csrf<button class="button secondary small">Record opt-out</button></form>
                        @else
                            <span class="badge">Opted out</span>
                        @endif
                    </div>
                @empty
                    <p class="muted">No newsletter subscribers yet.</p>
                @endforelse
                {{ $subscribers->links() }}
            </section>
        </div>
        <aside class="stack">
            <form class="panel stack" action="{{ route('outreach.newsletter') }}" method="post">
                @csrf<input type="hidden" name="campaign_key" value="{{ old('campaign_key', $campaignKey) }}">
                <div><span class="eyebrow">STUDIO NEWS</span><h2>Compose a preview</h2></div>
                <p class="muted">Prepare a plain-text newsletter for {{ $audienceCount }} consenting subscribers.</p>
                <label>Subject<input name="subject" required maxlength="160" value="{{ old('subject') }}" placeholder="A new season at the studio"></label>
                <label>Message<textarea name="body" rows="9" required maxlength="5000" placeholder="A little news to share…">{{ old('body') }}</textarea></label>
                <p class="field-help">Each preview includes an unsubscribe page. HTML is displayed as text.</p>
                <button class="button full">Create newsletter previews</button>
            </form>
            <section class="panel"><h2>Keep consent separate</h2><p>Appointment reminder permission never enrolls someone in marketing. Update birthday, anniversary and marketing channels on their client profile.</p><a class="text-link" href="{{ route('clients.index') }}">Your people ↗</a></section>
        </aside>
    </div>
@endsection
