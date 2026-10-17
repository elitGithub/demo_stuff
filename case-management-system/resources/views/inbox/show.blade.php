<x-app-layout :title="$message->subject">
    <div class="inbox-message-page">
        <a href="{{ route('inbox', ['label' => $label]) }}" class="mail-back" data-pending><x-icon name="arrow" class="icon-flip" />Back to mailbox</a>
        <x-demo-controls :progress="$progress" />
        <article class="surface mailbox-message">
            <header>
                <h1 class="detail-title">{{ $message->subject }}</h1>
                <dl class="mail-message-facts">
                    <div><dt>From</dt><dd>{{ $message->from_name }} &lt;{{ $message->from_email }}&gt;</dd></div>
                    <div><dt>To</dt><dd>{{ $message->to_email }}</dd></div>
                    <div><dt>Received</dt><dd><time datetime="{{ $message->received_at->toIso8601String() }}">{{ $message->received_at->timezone('America/Toronto')->format('M j, Y, g:i a') }}</time></dd></div>
                </dl>
                <div class="mail-row-badges">
                    @if ($message->is_notification)
                        <span class="mail-notification"><x-icon name="bell" />Casefile notification</span>
                    @elseif ($sender?->is_active)
                        <span class="tracked-badge"><x-icon name="check" />Tracked</span>
                    @else
                        <span class="muted">Not tracked</span>
                    @endif
                    @if ($case !== null)<a href="{{ route('cases.show', $case) }}" class="mail-case-chip mono" data-pending>{{ $case->number }}</a>@endif
                </div>
            </header>
            <div class="message-body mail-full-body">{{ $message->body_text }}</div>
            @if ($attachments->total() > 0)
                <section aria-label="Attachments">
                    <h2 class="section-title">Attachments ({{ $attachments->total() }})</h2>
                    <ul class="attachment-list">
                        @foreach ($attachments as $attachment)
                            <li><a href="{{ route('mailbox-attachments.show', $attachment) }}" class="attachment-chip" data-pending><x-icon name="paperclip" /><span class="attachment-chip-name">{{ $attachment->filename }}</span></a></li>
                        @endforeach
                    </ul>
                    <x-pagination :paginator="$attachments" />
                </section>
            @endif
        </article>
        @if (! $message->is_notification && $message->label === \App\Enums\MailboxLabel::Inbox && ! $sender?->is_active)
            <section class="surface mailbox-message" aria-labelledby="track-sender-heading">
                @if ($sender !== null)
                    <h2 id="track-sender-heading" class="section-title">Reactivate this sender</h2>
                    <p class="muted">This sender is inactive. Reactivating checks their existing inbox mail for cases.</p>
                    <form method="POST" action="{{ route('senders.reactivate', $sender) }}" data-pending>
                        @csrf
                        <button type="submit" class="btn btn-primary">Reactivate sender</button>
                    </form>
                @else
                    <h2 id="track-sender-heading" class="section-title">Track this sender</h2>
                    <p class="muted">Existing inbox mail from this address will be checked for cases.</p>
                    <form method="POST" action="{{ route('senders.store') }}" data-pending>
                        @csrf
                        <div class="field">
                            <label for="track-email">Email <span class="required-mark" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
                            <input id="track-email" name="email" type="text" inputmode="email" required maxlength="254" value="{{ $message->from_email }}">
                        </div>
                        <div class="field">
                            <label for="track-name">Name <span class="required-mark" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
                            <input id="track-name" name="name" type="text" required maxlength="120" value="{{ $message->from_name ?: $message->from_email }}">
                        </div>
                        <div class="form-actions"><button type="submit" class="btn btn-primary">Track this sender</button></div>
                    </form>
                @endif
            </section>
        @endif
    </div>
</x-app-layout>
