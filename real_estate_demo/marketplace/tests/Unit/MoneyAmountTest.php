<?php

namespace Tests\Unit;

use App\Rules\MoneyAmount;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class MoneyAmountTest extends TestCase
{
    #[DataProvider('amounts')]
    public function test_validates_form_amounts(mixed $value, bool $valid): void
    {
        $errors = [];
        $rule = new MoneyAmount(100);

        $rule->validate('amount', $value, function (string $message) use (&$errors): void {
            $errors[] = $message;
        });

        self::assertSame($valid, $errors === []);
    }

    public static function amounts(): array
    {
        return [['185.50', true], ['1.00', true], ['0.99', false], [185.50, false],
            [185, false], [null, false], [['100'], false], ['1e3', false]];
    }
}
