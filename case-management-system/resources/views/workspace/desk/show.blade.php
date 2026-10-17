@use('App\Support\DisplayDate')
@use('App\Enums\CaseStatus')
<x-app-layout :title="$case->number.' '.$case->subject">
    <x-slot:nav>
        <a href="{{ route('home') }}" aria-current="true" data-pending>Cases</a>
    </x-slot:nav>
    <div class="desk desk-show">
        <article class="desk-detail" aria-labelledby="case-heading">
            <a href="{{ $searchReturnUrl ?? route('home', $list->query) }}" class="back-link" data-pending><x-icon name="arrow" class="icon-flip" /><span>{{ $searchReturnUrl !== null ? 'Back to search' : 'Back to cases' }}</span></a>
            <div class="case-heading-actions">
                <h1 id="case-heading" class="detail-title">{{ $case->subject }}</h1>
                <a href="#case-details" class="btn details-toggle" data-details-open aria-controls="case-editor" aria-haspopup="dialog" aria-expanded="true">Manage case</a>
                <form method="POST" action="{{ route('cases.status', $case) }}" data-pending>
                    @csrf
                    @method('PATCH')
                    <input type="hidden" name="status" value="{{ $case->status === CaseStatus::Closed ? CaseStatus::Open->value : CaseStatus::Closed->value }}">
                    <button type="submit" class="btn">{{ $case->status === CaseStatus::Closed ? 'Reopen case' : 'Close case' }}</button>
                </form>
            </div>
            <section class="details-strip glass" aria-labelledby="details-heading">
                <h2 id="details-heading" class="sr-only">Case details</h2>
                <dl class="details-facts">
                    <div>
                        <dt>Case</dt>
                        <dd class="mono">{{ $case->number }}</dd>
                    </div>
                    <div>
                        <dt>Status</dt>
                        <dd><x-status-pill :status="$case->status" /></dd>
                    </div>
                    <div>
                        <dt>Received</dt>
                        <dd><time datetime="{{ DisplayDate::iso($case->received_at) }}">{{ DisplayDate::date($case->received_at) }}</time></dd>
                    </div>
                    @if ($case->closed_at !== null)
                        <div>
                            <dt>Closed</dt>
                            <dd><time datetime="{{ DisplayDate::iso($case->closed_at) }}">{{ DisplayDate::date($case->closed_at) }}</time></dd>
                        </div>
                    @endif
                    <div class="details-fact-wide">
                        <dt>Sender</dt>
                        <dd class="details-sender">
                            <span class="details-sender-name">{{ $case->sender_name }}</span>
                            <span class="details-sender-address">{{ $case->sender_email }}</span>
                            @if (filled($case->trackedSender->label))
                                <span class="muted">{{ $case->trackedSender->label }}</span>
                            @endif
                            @if ($case->trackedSender->is_active)
                                <span class="tracked-badge"><x-icon name="check" /><span>Tracked</span></span>
                            @else
                                <span class="tracked-badge tracked-badge-off"><span>No longer tracked</span></span>
                            @endif
                        </dd>
                    </div>
                </dl>
                <dl class="details-notes">
                    <div>
                        <dt>Issue</dt>
                        @if (filled($case->issue))
                            <dd class="details-text">{{ $case->issue }}</dd>
                        @else
                            <dd class="muted">Nothing noted yet.</dd>
                        @endif
                    </div>
                    <div>
                        <dt>Notes</dt>
                        @if (filled($case->notes))
                            <dd class="details-text">{{ $case->notes }}</dd>
                        @else
                            <dd class="muted">Nothing noted yet.</dd>
                        @endif
                    </div>
                </dl>
            </section>
            <dialog id="case-editor" class="case-edit-rail glass" aria-labelledby="case-editor-heading" data-details-sheet data-has-errors="{{ $errors->hasAny(['issue', 'notes', 'status']) ? 'true' : 'false' }}" open>
                <div class="details-sheet-actions">
                    <button type="button" class="btn btn-ghost" data-details-close><x-icon name="close" /><span>Close details</span></button>
                </div>
                <x-case-details-form :case="$case" />
            </dialog>
            <section class="desk-thread" aria-labelledby="thread-heading">
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
        </article>
        <x-case-list :cases="$list->cases" :counts="$list->counts" :status="$list->status" :current="$case" :list-query="$list->query" />
    </div>
</x-app-layout>
