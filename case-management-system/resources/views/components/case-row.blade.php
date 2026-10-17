@use('App\Enums\MessageDirection')
@use('App\Support\DisplayDate')
@use('Illuminate\Support\Str')
@props(['case', 'active' => false, 'listQuery' => []])
<a href="{{ route('cases.show', ['case' => $case->number, ...$listQuery]) }}" @class(['case-row', 'is-active' => $active]) @if ($active) aria-current="page" @endif data-pending>
    <x-avatar :name="$case->sender_name" />
    <span class="case-row-body">
        <span class="case-row-top">
            <span class="case-row-sender">{{ $case->sender_name }}</span>
            <time class="case-row-date" datetime="{{ DisplayDate::iso($case->received_at) }}">{{ DisplayDate::day($case->received_at) }}</time>
        </span>
        <span class="case-row-subject">{{ $case->subject }}</span>
        @if ($case->latestMessage !== null)
            <span class="case-row-snippet">{{ $case->latestMessage->direction === MessageDirection::Outbound ? 'You: ' : '' }}{{ Str::limit(Str::words(Str::squish($case->latestMessage->body_text), 24), 200) }}</span>
        @endif
        <span class="case-row-meta">
            <span class="mono">{{ $case->number }}</span>
            <x-status-pill :status="$case->status" />
            @if ($case->attachments_count > 0)
                <span class="case-row-clip"><x-icon name="paperclip" /><span class="sr-only">Has attachments</span></span>
            @endif
        </span>
    </span>
</a>
