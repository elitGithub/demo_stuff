@props(['list', 'current' => null])
@use('App\Enums\MessageDirection')
@use('App\Enums\CaseStatus')
@use('App\Support\DisplayDate')
<section class="mail-case-list glass" aria-labelledby="mail-list-heading">
    <header class="mail-list-heading">
        <h2 id="mail-list-heading">{{ $list->status?->label() ?? 'All cases' }}</h2><span class="muted">{{ $list->cases->total() }} cases</span>
        <nav class="mail-filters tracker-filters" aria-label="Filter cases">
            @foreach ([null, ...CaseStatus::cases()] as $status)
                <a href="{{ route('home', $status === null ? [] : ['status' => $status->value]) }}" class="pill tracker-filter" @if ($status === $list->status) aria-current="{{ $current === null ? 'page' : 'true' }}" @endif data-pending>{{ $status?->label() ?? 'All' }} <span>{{ $list->counts->forStatus($status) }}</span></a>
            @endforeach
        </nav>
    </header>
    <ol class="mail-case-rows">
        @forelse ($list->cases as $row)
            <li>
                <a class="mail-case-row" href="{{ route('cases.show', ['case' => $row, ...$list->query]) }}" @if ($current !== null && $row->is($current)) aria-current="page" @endif data-pending>
                    <span class="mail-case-top"><strong>{{ $row->sender_name }}</strong><time datetime="{{ DisplayDate::iso($row->received_at) }}">{{ DisplayDate::date($row->received_at) }}</time></span>
                    <span class="mail-case-subject">{{ $row->subject }}</span>
                    <span class="mail-case-preview">{{ $row->latestMessage?->body_text }}</span>
                    <span class="mail-case-meta"><span class="mono">{{ $row->number }}</span><x-status-pill :status="$row->status" />
                        @if ($row->latestMessage?->direction === MessageDirection::Inbound)<span class="mail-unread" role="img" aria-label="Latest message is inbound"></span>@endif
                    </span>
                </a>
            </li>
        @empty
            <li><x-empty-state title="No cases on this page."><a href="{{ $list->cases->url(1) }}" data-pending>Go to the first page</a></x-empty-state></li>
        @endforelse
    </ol>
    <x-pagination :paginator="$list->cases" />
</section>
