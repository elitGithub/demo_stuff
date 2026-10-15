@if ($records->hasPages())
    <nav class="pagination" aria-label="Pagination">
        <span>{{ $records->firstItem() }}–{{ $records->lastItem() }} of {{ $records->total() }}</span>
        <div>
            @if ($records->previousPageUrl())
                <a class="button secondary small" href="{{ $records->previousPageUrl() }}">← Previous</a>
                @endif @if ($records->nextPageUrl())
                    <a class="button secondary small" href="{{ $records->nextPageUrl() }}">Next →</a>
                @endif
        </div>
    </nav>
@endif
