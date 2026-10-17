<?php

namespace Tests\Feature;

use App\Actions\Cases\AllocateCaseNumber;
use App\Models\CaseNumberSequence;
use Illuminate\Database\MultipleRecordsFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

class AllocateCaseNumberTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @param  int  $nextNumber
     * @return CaseNumberSequence
     */
    private function sequenceAt(int $nextNumber): CaseNumberSequence
    {
        return CaseNumberSequence::query()->create(['next_number' => $nextNumber]);
    }

    /**
     * @return void
     */
    public function test_numbers_are_sequential_from_one(): void
    {
        $this->sequenceAt(1);
        $allocate = new AllocateCaseNumber;

        $this->assertSame('CASE-0001', $allocate());
        $this->assertSame('CASE-0002', $allocate());
    }

    /**
     * @return void
     */
    public function test_sequence_row_advances_by_exactly_one_per_call(): void
    {
        $sequence = $this->sequenceAt(7);
        $allocate = new AllocateCaseNumber;

        $allocate();
        $this->assertSame(8, $sequence->refresh()->next_number);

        $allocate();
        $allocate();
        $this->assertSame(10, $sequence->refresh()->next_number);
        $this->assertSame(1, CaseNumberSequence::query()->count());
    }

    /**
     * @return void
     */
    public function test_numbers_above_nine_thousand_nine_hundred_ninety_nine_keep_growing(): void
    {
        $sequence = $this->sequenceAt(9999);
        $allocate = new AllocateCaseNumber;

        $this->assertSame('CASE-9999', $allocate());
        $this->assertSame('CASE-10000', $allocate());
        $this->assertSame(10001, $sequence->refresh()->next_number);
    }

    /**
     * @return void
     */
    public function test_missing_sequence_row_fails_loudly(): void
    {
        $allocate = new AllocateCaseNumber;

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Case number sequence is not initialised; run the seeder.');

        $allocate();
    }

    /**
     * @return void
     */
    public function test_allocation_rolls_back_with_an_enclosing_transaction(): void
    {
        $sequence = $this->sequenceAt(5);

        try {
            DB::transaction(function () use ($sequence): void {
                $this->assertSame('CASE-0005', (new AllocateCaseNumber)());
                $this->assertSame('CASE-0006', (new AllocateCaseNumber)());
                $this->assertSame(7, $sequence->refresh()->next_number);

                throw new RuntimeException('abort');
            });
        } catch (RuntimeException $exception) {
            $this->assertSame('abort', $exception->getMessage());
        }

        $this->assertSame(5, $sequence->refresh()->next_number);
        $this->assertSame('CASE-0005', (new AllocateCaseNumber)());
    }

    /**
     * @return void
     */
    public function test_allocation_in_a_committing_outer_transaction_advances_by_one(): void
    {
        $sequence = $this->sequenceAt(5);

        $number = DB::transaction(fn (): string => (new AllocateCaseNumber)());

        $this->assertSame('CASE-0005', $number);
        $this->assertSame(6, $sequence->refresh()->next_number);
    }

    /**
     * @return void
     */
    public function test_a_second_sequence_row_fails_loudly(): void
    {
        $this->sequenceAt(1);
        $this->sequenceAt(1);

        $this->expectException(MultipleRecordsFoundException::class);

        (new AllocateCaseNumber)();
    }

    /**
     * @return void
     */
    public function test_sqlite_connection_is_configured_for_immediate_transactions(): void
    {
        $this->assertSame('IMMEDIATE', config('database.connections.sqlite.transaction_mode'));
        $this->assertSame(5000, config('database.connections.sqlite.busy_timeout'));
    }
}
