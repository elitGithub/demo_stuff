<x-app-layout title="Search cases">
    <div class="search-page">
        <header>
            <p class="eyebrow">Find a conversation</p>
            <h1>Search cases</h1>
            <p class="muted">Search case numbers, subjects, issues, notes and every email in a conversation.</p>
        </header>
        <x-search-box :filters="$filters" :senders="$senders" />
        <section class="search-results surface" aria-labelledby="search-results-heading">
            <header class="search-results-heading">
                <h2 id="search-results-heading">Results</h2>
                <p class="muted" role="status">{{ $cases->total() }} {{ $cases->total() === 1 ? 'case' : 'cases' }} match. Newest first.</p>
            </header>
            @if ($cases->isEmpty())
                <x-empty-state icon="search" :title="$cases->total() === 0 ? 'No cases match.' : 'No cases on this page.'">
                    @if ($cases->total() > 0)
                        <a href="{{ route('search', $filters->parameters()) }}" class="btn" data-pending>First page</a>
                    @else
                        Try another keyword or broaden the filters.
                    @endif
                </x-empty-state>
            @else
                <ol class="search-result-list">
                    @foreach ($cases as $case)
                        <li><x-case-row :case="$case" :list-query="$listQuery" /></li>
                    @endforeach
                </ol>
            @endif
            <x-pagination :paginator="$cases" />
        </section>
    </div>
</x-app-layout>
