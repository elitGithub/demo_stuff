<?php

namespace App\Actions\Cases;

use App\Models\CaseNumberSequence;
use Illuminate\Database\MultipleRecordsFoundException;
use Illuminate\Database\RecordsNotFoundException;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

class AllocateCaseNumber
{
    /**
     * @return string
     *
     * @throws RuntimeException
     * @throws MultipleRecordsFoundException
     * @throws Throwable
     */
    public function __invoke(): string
    {
        return DB::transaction(function (): string {
            try {
                $sequence = CaseNumberSequence::query()->lockForUpdate()->sole();
            } catch (RecordsNotFoundException $exception) {
                throw new RuntimeException('Case number sequence is not initialised; run the seeder.', previous: $exception);
            }

            $number = $sequence->next_number;
            $sequence->next_number = $number + 1;
            $sequence->save();

            return sprintf('CASE-%04d', $number);
        });
    }
}
