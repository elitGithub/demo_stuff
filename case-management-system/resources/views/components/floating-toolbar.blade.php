@props(['case'])
@use('App\Enums\CaseStatus')
<nav class="floating-toolbar glass" aria-label="Case actions">
    <a href="#reply-body" class="btn" data-focus-reply>Reply</a>
    <a href="#case-notes" class="btn" data-details-open data-details-focus="case-notes" aria-controls="case-editor" aria-haspopup="dialog" aria-expanded="true">Note</a>
    @if ($case->status !== CaseStatus::InProgress)
        <form method="POST" action="{{ route('cases.status', $case) }}" data-pending>
            @csrf
            @method('PATCH')
            <input type="hidden" name="status" value="{{ CaseStatus::InProgress->value }}">
            <button type="submit" class="btn">In progress</button>
        </form>
    @endif
    <form method="POST" action="{{ route('cases.status', $case) }}" data-pending>
        @csrf
        @method('PATCH')
        <input type="hidden" name="status" value="{{ $case->status === CaseStatus::Closed ? CaseStatus::Open->value : CaseStatus::Closed->value }}">
        <button type="submit" class="btn">{{ $case->status === CaseStatus::Closed ? 'Reopen case' : 'Close case' }}</button>
    </form>
</nav>
