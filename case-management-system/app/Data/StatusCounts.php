<?php

namespace App\Data;

use App\Enums\CaseStatus;
use App\Queries\CaseListQuery;

final readonly class StatusCounts
{
    /**
     * @param  int  $all
     * @param  int  $open
     * @param  int  $inProgress
     * @param  int  $closed
     */
    public function __construct(
        public int $all,
        public int $open,
        public int $inProgress,
        public int $closed,
    ) {}

    /**
     * @return self
     */
    public static function fromDatabase(): self
    {
        $totals = CaseListQuery::base()
            ->toBase()
            ->select('status')
            ->selectRaw('count(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status')
            ->map(fn (int|string $total): int => (int) $total);

        return new self(
            all: $totals->sum(),
            open: $totals->get(CaseStatus::Open->value, 0),
            inProgress: $totals->get(CaseStatus::InProgress->value, 0),
            closed: $totals->get(CaseStatus::Closed->value, 0),
        );
    }

    /**
     * @param  ?CaseStatus  $status
     * @return int
     */
    public function forStatus(?CaseStatus $status): int
    {
        return match ($status) {
            null => $this->all,
            CaseStatus::Open => $this->open,
            CaseStatus::InProgress => $this->inProgress,
            CaseStatus::Closed => $this->closed,
        };
    }
}
