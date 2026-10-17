<?php

namespace App\Rules;

use App\Support\Money;
use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use InvalidArgumentException;

class MoneyAmount implements ValidationRule
{
    public function __construct(private int $minimum = 0) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_string($value)) {
            $fail('Enter an amount with up to two decimal places.');

            return;
        }

        try {
            Money::parse($value, $this->minimum);
        } catch (InvalidArgumentException $exception) {
            $fail($exception->getMessage());
        }
    }
}
