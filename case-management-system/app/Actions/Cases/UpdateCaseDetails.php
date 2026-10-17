<?php

namespace App\Actions\Cases;

use App\Enums\CaseStatus;
use App\Models\CaseRecord;
use Illuminate\Support\Facades\DB;
use Throwable;

final class UpdateCaseDetails
{
    /**
     * @param  ChangeCaseStatus  $changeStatus
     */
    public function __construct(private readonly ChangeCaseStatus $changeStatus) {}

    /**
     * @param  CaseRecord  $case
     * @param  ?string  $issue
     * @param  ?string  $notes
     * @param  ?CaseStatus  $status
     * @return CaseRecord
     *
     * @throws Throwable
     */
    public function __invoke(CaseRecord $case, ?string $issue, ?string $notes, ?CaseStatus $status = null): CaseRecord
    {
        return DB::transaction(function () use ($case, $issue, $notes, $status): CaseRecord {
            $current = CaseRecord::query()->lockForUpdate()->findOrFail($case->getKey());
            $current->fill(['issue' => $issue, 'notes' => $notes])->save();

            return $status === null ? $current : ($this->changeStatus)(case: $current, to: $status);
        });
    }
}
