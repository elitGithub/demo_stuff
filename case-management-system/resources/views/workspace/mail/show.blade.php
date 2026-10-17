@use('App\Enums\CaseStatus')
@use('App\Support\DisplayDate')
<x-app-layout :title="$case->number.' '.$case->subject">
    <div class="mail-workspace mail-show">
        <x-mail-case-list :list="$list" :current="$case" />
        <article class="mail-reading" aria-labelledby="case-heading">
            <a href="{{ $searchReturnUrl ?? route('home', $list->query) }}" class="back-link" data-pending><x-icon name="arrow" class="icon-flip" /><span>{{ $searchReturnUrl !== null ? 'Back to search' : 'Back to cases' }}</span></a>
            <header class="case-heading-actions"><h1 id="case-heading">{{ $case->subject }}</h1><a href="#case-details" class="btn details-toggle" data-details-open aria-controls="case-editor" aria-haspopup="dialog" aria-expanded="true">Manage case</a></header>
            <dl class="mail-facts tracker-facts glass">
                <div><dt>Case</dt><dd class="mono">{{ $case->number }}</dd></div>
                <div><dt>Status</dt><dd><x-status-pill :status="$case->status" /></dd></div>
                <div><dt>Received</dt><dd><time datetime="{{ DisplayDate::iso($case->received_at) }}">{{ DisplayDate::date($case->received_at) }}</time></dd></div>
                @if ($case->closed_at !== null)<div><dt>Closed</dt><dd>{{ DisplayDate::date($case->closed_at) }}</dd></div>@endif
                <div><dt>Sender</dt><dd>{{ $case->sender_name }}<span class="muted">{{ $case->sender_email }}</span><span class="tracked-badge">{{ $case->trackedSender->is_active ? 'Tracked' : 'No longer tracked' }}</span></dd></div>
                <div class="mail-fact-issue"><dt>Issue</dt><dd class="details-text">{{ filled($case->issue) ? $case->issue : 'Nothing noted yet.' }}</dd></div>
            </dl>
            <dialog id="case-editor" class="case-edit-rail glass" aria-labelledby="case-editor-heading" data-details-sheet data-has-errors="{{ $errors->hasAny(['issue', 'notes', 'status']) ? 'true' : 'false' }}" open>
                <div class="details-sheet-actions"><button type="button" class="btn btn-ghost" data-details-close><x-icon name="close" /><span>Close details</span></button></div>
                <x-case-details-form :case="$case" />
            </dialog>
            <section class="mail-conversation" aria-labelledby="thread-heading">
                <h2 id="thread-heading" class="sr-only">Conversation</h2>
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
            </section>
            <x-reply-composer :case="$case" />
            <x-floating-toolbar :case="$case" />
        </article>
    </div>
</x-app-layout>
