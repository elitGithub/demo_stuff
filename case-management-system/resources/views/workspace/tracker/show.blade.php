@use('App\Enums\CaseStatus')
@use('App\Support\DisplayDate')
<x-app-layout :title="$case->number.' '.$case->subject">
    <article class="tracker-case" aria-labelledby="case-heading">
        <a href="{{ $searchReturnUrl ?? route('home', $list->query) }}" class="back-link" data-pending><x-icon name="arrow" class="icon-flip" /><span>{{ $searchReturnUrl !== null ? 'Back to search' : 'Back to cases' }}</span></a>
        <header class="tracker-case-heading">
            <div><p class="mono muted">{{ $case->number }}</p><h1 id="case-heading">{{ $case->subject }}</h1></div>
            <form method="POST" action="{{ route('cases.status', $case) }}" data-pending>
                @csrf
                @method('PATCH')
                <input type="hidden" name="status" value="{{ $case->status === CaseStatus::Closed ? CaseStatus::Open->value : CaseStatus::Closed->value }}">
                <button type="submit" class="btn">{{ $case->status === CaseStatus::Closed ? 'Reopen case' : 'Close case' }}</button>
            </form>
        </header>
        <dl class="tracker-facts glass">
            <div><dt>Status</dt><dd><x-status-pill :status="$case->status" /></dd></div>
            <div><dt>Received</dt><dd><time datetime="{{ DisplayDate::iso($case->received_at) }}">{{ DisplayDate::date($case->received_at) }}</time></dd></div>
            @if ($case->closed_at !== null)<div><dt>Closed</dt><dd><time datetime="{{ DisplayDate::iso($case->closed_at) }}">{{ DisplayDate::date($case->closed_at) }}</time></dd></div>@endif
            <div><dt>Sender</dt><dd>{{ $case->sender_name }} <span class="muted">{{ $case->sender_email }}</span></dd></div>
        </dl>
        <div class="tracker-case-body">
            <section class="tracker-conversation" aria-labelledby="thread-heading">
                <h2 id="thread-heading" class="section-title">Conversation</h2>
                <x-case-thread :case="$case" />
                <div id="thread-end" tabindex="-1">
                    @if (session('auto_reply_case') === $case->number && $case->status !== CaseStatus::Closed)
                        <div class="auto-reply surface" data-auto-reply data-case="{{ $case->number }}" data-delay="{{ config('casefile.demo.auto_reply_delay_seconds') }}" data-url="{{ route('demo.auto-reply', $case) }}">
                            <p role="status" aria-live="polite" data-auto-reply-status>Waiting for a reply…</p>
                            <button type="button" class="btn" data-auto-reply-retry hidden>Check for a reply</button>
                            <a href="{{ route('cases.show', $case) }}#thread-end" class="btn btn-danger" data-auto-reply-show data-pending hidden>Discard unsaved edits and show reply</a>
                        </div>
                    @endif
                </div>
                <x-reply-composer :case="$case" />
            </section>
            <section class="tracker-editor glass" aria-labelledby="case-editor-heading"><x-case-details-form :case="$case" /></section>
        </div>
    </article>
</x-app-layout>
