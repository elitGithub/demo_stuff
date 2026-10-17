<?php

namespace Tests\Unit;

use App\Support\Money;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class MoneyTest extends TestCase
{
    #[DataProvider('validAmounts')]
    public function test_parses_exact_cents(string $input, int $expected): void
    {
        self::assertSame($expected, Money::parse($input));
    }

    public static function validAmounts(): array
    {
        return [['0', 0], ['0.01', 1], ['1.1', 110], ['1.01', 101],
            ['185.50', 18550], ['100000.00', 10000000]];
    }

    #[DataProvider('invalidAmounts')]
    public function test_rejects_ambiguous_or_out_of_range_amounts(string $input): void
    {
        $this->expectException(InvalidArgumentException::class);

        Money::parse($input);
    }

    public static function invalidAmounts(): array
    {
        return array_map(fn (string $value): array => [$value], [
            '-1', '1e3', '1.005', '100000.01', '1,000', '', 'NaN', '01.50',
            ' 1', '1 ', "1\n", '+1', '.50', '1.', '999999999999999999999',
        ]);
    }

    public function test_enforces_the_minimum_quote_amount(): void
    {
        $this->expectException(InvalidArgumentException::class);

        Money::parse('0.99', 100);
    }

    public function test_enforces_a_callers_lower_maximum(): void
    {
        $this->expectException(InvalidArgumentException::class);

        Money::parse('5.01', 0, 500);
    }

    #[DataProvider('formattedAmounts')]
    public function test_formats_cents_without_rounding(int $cents, string $expected): void
    {
        self::assertSame($expected, Money::format($cents));
    }

    public static function formattedAmounts(): array
    {
        return [[0, '$0.00'], [101, '$1.01'], [18550, '$185.50'], [10000000, '$100,000.00']];
    }
}
