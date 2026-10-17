<?php

namespace App\Support;

use InvalidArgumentException;

final class Money
{
    public static function parse(string $value, int $minimum = 0, int $maximum = 10000000): int
    {
        if (! preg_match('/^(0|[1-9][0-9]{0,5})(?:\.([0-9]{1,2}))?$/D', $value, $parts)) {
            throw new InvalidArgumentException('Enter an amount with up to two decimal places.');
        }

        $cents = ((int) $parts[1] * 100) + (int) str_pad($parts[2] ?? '', 2, '0');

        if ($cents < $minimum || $cents > $maximum) {
            throw new InvalidArgumentException('The amount is outside the allowed range.');
        }

        return $cents;
    }

    public static function format(int $cents): string
    {
        $whole = (string) intdiv($cents, 100);
        $grouped = preg_replace('/\B(?=(\d{3})+(?!\d))/', ',', $whole);

        return '$'.$grouped.'.'.str_pad((string) ($cents % 100), 2, '0', STR_PAD_LEFT);
    }
}
