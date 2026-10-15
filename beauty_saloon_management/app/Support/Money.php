<?php

namespace App\Support;

class Money
{
    public static function format(int $amount, ?string $currency = null): string
    {
        $currency ??= config('studio.currency');
        $symbol = ['USD' => '$', 'EUR' => '€', 'GBP' => '£', 'ILS' => '₪', 'INR' => '₹'][$currency] ?? $currency.' ';

        return $symbol.number_format($amount / 100, 2);
    }
}
