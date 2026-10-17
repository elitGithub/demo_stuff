@props(['paginator'])
@if ($paginator->hasPages() && $paginator->currentPage() <= $paginator->lastPage())
    <nav {{ $attributes->class(['pagination']) }} aria-label="Pages">
        @if ($paginator->onFirstPage())
            <span class="pagination-link pagination-link-off"><x-icon name="arrow" class="icon-flip" /><span>Previous</span></span>
        @else
            <a href="{{ $paginator->previousPageUrl() }}" class="pagination-link" rel="prev" data-pending><x-icon name="arrow" class="icon-flip" /><span>Previous</span></a>
        @endif
        <span class="pagination-status">Page {{ $paginator->currentPage() }} of {{ $paginator->lastPage() }}</span>
        @if ($paginator->hasMorePages())
            <a href="{{ $paginator->nextPageUrl() }}" class="pagination-link" rel="next" data-pending><span>Next</span><x-icon name="arrow" /></a>
        @else
            <span class="pagination-link pagination-link-off"><span>Next</span><x-icon name="arrow" /></span>
        @endif
    </nav>
@endif
