<?php

namespace App\Data;

use App\Enums\CaseStatus;
use App\Models\CaseRecord;
use Illuminate\Pagination\LengthAwarePaginator;

final readonly class ListContext
{
    /**
     * @param  LengthAwarePaginator<int, CaseRecord>  $cases
     * @param  StatusCounts  $counts
     * @param  ?CaseStatus  $status
     * @param  array<string, int|string>  $query
     */
    public function __construct(
        public LengthAwarePaginator $cases,
        public StatusCounts $counts,
        public ?CaseStatus $status,
        public array $query,
    ) {}
}
