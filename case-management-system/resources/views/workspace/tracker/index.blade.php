@use('App\Enums\CaseStatus')
@use('App\Support\DisplayDate')
<x-app-layout :title="$list->status?->label() ?? 'All cases'">
    <div class="tracker">
        <nav class="tracker-sidebar glass" aria-label="Saved views">
            @foreach ([null, ...CaseStatus::cases()] as $status)
                <a href="{{ route('home', $status === null ? [] : ['status' => $status->value]) }}" class="folder-link" @if ($status === $list->status) aria-current="page" @endif data-pending>
                    @if ($status === null)<x-icon name="folder" />@else<span class="glyph {{ $status->glyphClass() }}" aria-hidden="true"></span>@endif
                    <span class="folder-name">{{ $status?->label() ?? 'All' }}</span>
                    <span class="folder-count">{{ $list->counts->forStatus($status) }}</span>
                </a>
            @endforeach
            <a href="{{ route('settings') }}" class="folder-link" data-pending><x-icon name="user" /><span class="folder-name">Senders</span></a>
            <a href="{{ route('search') }}" class="folder-link" data-pending><x-icon name="search" /><span class="folder-name">Search</span></a>
        </nav>
        <section class="tracker-list surface" aria-labelledby="tracker-heading">
            <header class="tracker-heading">
                <div><p class="eyebrow">Tracker</p><h1 id="tracker-heading">{{ $list->status?->label() ?? 'All cases' }}</h1></div>
                <p class="muted">{{ $list->counts->forStatus($list->status) }} {{ $list->counts->forStatus($list->status) === 1 ? 'case' : 'cases' }}</p>
                <nav class="tracker-filters" aria-label="Filter cases">
                    @foreach ([null, ...CaseStatus::cases()] as $status)
                        <a href="{{ route('home', $status === null ? [] : ['status' => $status->value]) }}" class="pill tracker-filter" @if ($status === $list->status) aria-current="true" @endif data-pending>{{ $status?->label() ?? 'All' }} <span>{{ $list->counts->forStatus($status) }}</span></a>
                    @endforeach
                </nav>
            </header>
            @if ($list->cases->isNotEmpty())
                <ol class="tracker-rows">
                    @foreach ($list->cases as $case)
                        <li>
                            <a href="{{ route('cases.show', ['case' => $case->number, ...$list->query]) }}" class="tracker-row" data-pending>
                                <span class="glyph {{ $case->status->glyphClass() }}" aria-hidden="true"></span><span class="sr-only">{{ $case->status->label() }}</span>
                                <span class="tracker-number mono">{{ $case->number }}</span>
                                <span class="tracker-subject">{{ $case->subject }}</span>
                                <span class="tracker-sender">{{ $case->sender_name }}</span>
                                <span class="tracker-attachment">@if ($case->attachments_count > 0)<x-icon name="paperclip" /><span class="sr-only">Has attachments</span>@endif</span>
                                <time datetime="{{ DisplayDate::iso($case->received_at) }}">{{ DisplayDate::day($case->received_at) }}</time>
                            </a>
                        </li>
                    @endforeach
                </ol>
            @elseif ($list->cases->currentPage() > $list->cases->lastPage())
                <x-empty-state title="This page is past the end of the list."><a href="{{ $list->cases->url(1) }}" data-pending>Go to the first page</a></x-empty-state>
            @else
                <x-empty-state title="No cases here yet.">Cases appear here when they reach this status.</x-empty-state>
            @endif
            <x-pagination :paginator="$list->cases" />
        </section>
    </div>
</x-app-layout>
