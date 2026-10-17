@use('App\Enums\CaseStatus')
@props(['cases', 'counts', 'status' => null, 'current' => null, 'listQuery' => []])
<nav class="desk-folders glass" aria-label="Case folders">
    @foreach ([null, ...CaseStatus::cases()] as $folder)
        <a href="{{ route('home', $folder === null ? [] : ['status' => $folder->value]) }}" class="folder-link" @if ($folder === $status) aria-current="{{ $current === null ? 'page' : 'true' }}" @endif data-pending>
            @if ($folder === null)
                <x-icon name="folder" />
            @else
                <span class="glyph {{ $folder->glyphClass() }}" aria-hidden="true"></span>
            @endif
            <span class="folder-name">{{ $folder?->label() ?? 'All cases' }}</span>
            <span class="folder-count">{{ $counts->forStatus($folder) }}</span>
        </a>
    @endforeach
</nav>
<section class="desk-list surface" aria-labelledby="case-list-heading">
    <h2 id="case-list-heading" class="desk-list-heading">{{ $status?->label() ?? 'All cases' }}</h2>
    @if ($cases->isNotEmpty())
        <ol class="case-rows">
            @foreach ($cases as $row)
                <li><x-case-row :case="$row" :active="$current !== null && $row->is($current)" :list-query="$listQuery" /></li>
            @endforeach
        </ol>
    @elseif ($cases->currentPage() > $cases->lastPage())
        <x-empty-state title="This page is past the end of the list.">
            <a href="{{ $cases->url(1) }}" data-pending>Go to the first page</a>
        </x-empty-state>
    @else
        <x-empty-state title="No cases here yet.">
            {{ $status === null ? 'Emails from the senders you track become cases here.' : 'Cases appear here when they reach this status.' }}
        </x-empty-state>
    @endif
    <x-pagination :paginator="$cases" />
</section>
