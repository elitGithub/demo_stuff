@props(['case', 'pages'])
@use('App\Enums\CaseStatus')
@use('App\Support\DisplayDate')
<article id="board-card-{{ $case->number }}" class="board-card surface" tabindex="-1">
    <a href="{{ route('cases.show', $case) }}" class="board-card-link" data-pending>
        <span class="mono muted">{{ $case->number }}</span>
        <h3>{{ $case->subject }}</h3>
        <span class="muted">{{ $case->sender_name }}</span>
        <span class="board-card-meta"><time datetime="{{ DisplayDate::iso($case->received_at) }}">{{ DisplayDate::date($case->received_at) }}</time>@if ($case->attachments_count > 0)<span><x-icon name="paperclip" /><span class="sr-only">Has attachments</span></span>@endif</span>
    </a>
    <form method="POST" action="{{ route('cases.status', $case) }}" data-pending data-board-status-form>
        @csrf
        @method('PATCH')
        <input type="hidden" name="return_to" value="board">
        @foreach ($pages as $name => $page)<input type="hidden" name="board[{{ $name }}]" value="{{ $page }}">@endforeach
        <div class="field"><label for="board-status-{{ $case->number }}">Status <span class="required-mark" aria-hidden="true">*</span><span class="sr-only"> (required)</span></label>
            <select id="board-status-{{ $case->number }}" name="status" required data-board-status-select>
                @foreach (CaseStatus::cases() as $status)<option value="{{ $status->value }}" @selected($case->status === $status)>{{ $status->label() }}</option>@endforeach
            </select>
        </div>
        <button type="submit" class="btn board-status-save">Save status</button>
    </form>
</article>
