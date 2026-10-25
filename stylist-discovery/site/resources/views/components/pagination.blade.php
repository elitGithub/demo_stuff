@props(['paginator', 'fragment' => null, 'label' => 'Results'])
@if($paginator->hasPages())
    <nav class="pagination" aria-label="{{ $label }} pages">
        @if($paginator->onFirstPage())<span aria-disabled="true">Previous</span>@else<a rel="prev" href="{{ $paginator->previousPageUrl() }}{{ $fragment ? '#'.$fragment : '' }}">Previous</a>@endif
        <span>Page {{ $paginator->currentPage() }} of {{ $paginator->lastPage() }}</span>
        @if($paginator->hasMorePages())<a rel="next" href="{{ $paginator->nextPageUrl() }}{{ $fragment ? '#'.$fragment : '' }}">Next</a>@else<span aria-disabled="true">Next</span>@endif
    </nav>
@endif
