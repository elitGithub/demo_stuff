@use('App\Enums\MessageDirection')
@use('App\Models\CaseMessage')
@use('App\Support\DisplayDate')
@if ($entries->isEmpty())
    <x-empty-state icon="mail" title="No messages in this case yet." />
@else
    <ol {{ $attributes->class(['thread']) }} aria-label="Conversation">
        @foreach ($entries as $entry)
            @if ($entry instanceof CaseMessage)
                @php
                    $outbound = $entry->direction === MessageDirection::Outbound;
                @endphp
                <li @class(['message', 'surface', 'message-outbound' => $outbound])>
                    <header class="message-head">
                        <x-avatar :name="$entry->from_name ?? $entry->from_email" />
                        <div class="message-who">
                            @if ($outbound)
                                <p class="message-name">{{ $simulated ? 'You · sent via Gmail (simulated)' : 'You · sent via Gmail' }}</p>
                            @else
                                <p class="message-name">{{ $entry->from_name ?? $entry->from_email }}</p>
                                @if ($entry->from_name !== null)
                                    <p class="message-address">{{ $entry->from_email }}</p>
                                @endif
                            @endif
                            <p class="message-meta">
                                <span class="message-mark"><x-icon :name="$outbound ? 'send' : 'inbox'" /><span>{{ $outbound ? 'Sent' : 'Received' }}</span></span>
                                <time datetime="{{ DisplayDate::iso($entry->sent_at) }}">{{ DisplayDate::date($entry->sent_at) }} · {{ DisplayDate::time($entry->sent_at) }}</time>
                            </p>
                        </div>
                    </header>
                    <div class="message-body">{{ $entry->body_text }}</div>
                    @if ($entry->attachments->isNotEmpty())
                        <ul class="attachment-list" aria-label="Attachments">
                            @foreach ($entry->attachments as $attachment)
                                <li><x-attachment-chip :attachment="$attachment" /></li>
                            @endforeach
                        </ul>
                    @endif
                </li>
            @else
                <li class="thread-event">
                    <x-icon name="info" />
                    <span>{{ $entry->kind->label() }}</span>
                    @if ($entry->from_status !== null && $entry->to_status !== null)
                        <span>from</span>
                        <x-status-pill :status="$entry->from_status" />
                        <span>to</span>
                        <x-status-pill :status="$entry->to_status" />
                    @endif
                    <time datetime="{{ DisplayDate::iso($entry->occurred_at) }}">{{ DisplayDate::date($entry->occurred_at) }} · {{ DisplayDate::time($entry->occurred_at) }}</time>
                </li>
            @endif
        @endforeach
    </ol>
@endif
