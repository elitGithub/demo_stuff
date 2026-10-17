<?php

namespace App\Actions\Cases;

use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use App\Models\CaseRecord;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Throwable;

final class ChangeCaseStatus
{
    /**
     * @param  CaseRecord  $case
     * @param  CaseStatus  $to
     * @return CaseRecord
     *
     * @throws Throwable
     */
    public function __invoke(CaseRecord $case, CaseStatus $to): CaseRecord
    {
        return DB::transaction(function () use ($case, $to): CaseRecord {
            $current = CaseRecord::query()->lockForUpdate()->findOrFail($case->getKey());
            $from = $current->status;

            if ($from === $to) {
                return $current;
            }

            $occurredAt = CarbonImmutable::now();
            $current->fill(['status' => $to, 'closed_at' => $to === CaseStatus::Closed ? $occurredAt : null])->save();
            $current->events()->create([
                'kind' => CaseEventKind::StatusChanged,
                'from_status' => $from,
                'to_status' => $to,
                'occurred_at' => $occurredAt,
            ]);

            if ($from === CaseStatus::Closed) {
                $current->events()->create([
                    'kind' => CaseEventKind::Reopened,
                    'from_status' => $from,
                    'to_status' => $to,
                    'occurred_at' => $occurredAt,
                ]);
            }

            return $current;
        });
    }
}
