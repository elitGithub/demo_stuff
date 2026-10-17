@props(['message', 'sender' => null, 'case' => null, 'label' => 'inbox'])
<li class="mail-row">
    <a href="{{ route('inbox.show', ['message' => $message, 'label' => $label]) }}" class="mail-row-link" data-pending>
        <span class="mail-row-top">
            <span class="mail-row-sender">{{ $message->label === \App\Enums\MailboxLabel::Sent ? 'To: '.$message->to_email : ($message->from_name ?: $message->from_email) }}</span>
            <time datetime="{{ $message->received_at->toIso8601String() }}">{{ $message->received_at->timezone('America/Toronto')->format('M j, Y') }}</time>
        </span>
        <span class="mail-row-subject">{{ $message->subject }}</span>
        <span class="mail-row-snippet">{{ $message->snippet }}</span>
        @if ($message->attachments_count > 0)
            <span class="mail-row-attachment"><x-icon name="paperclip" /><span>Attachments</span></span>
        @endif
    </a>
    <div class="mail-row-badges">
        @if ($message->is_notification)
            <span class="mail-notification"><x-icon name="bell" />Casefile notification</span>
        @elseif ($sender?->is_active)
            <span class="tracked-badge"><x-icon name="check" />Tracked</span>
        @else
            <span class="muted">Not tracked</span>
        @endif
        @if ($case !== null)
            <a class="mail-case-chip mono" href="{{ route('cases.show', $case) }}" data-pending>{{ $case->number }}</a>
        @endif
    </div>
</li>
