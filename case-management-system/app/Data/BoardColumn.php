<?php

namespace App\Data;

use App\Enums\CaseStatus;
use App\Models\CaseRecord;
use Illuminate\Pagination\LengthAwarePaginator;

final readonly class BoardColumn
{
    /**
     * @param  CaseStatus  $status
     * @param  LengthAwarePaginator<int, CaseRecord>  $cases
     */
    public function __construct(public CaseStatus $status, public LengthAwarePaginator $cases) {}
}
