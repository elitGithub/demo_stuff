<?php

namespace App\Enums;

enum DiscoverySort: string
{
    case Name = 'name';
    case PriceAscending = 'price_ascending';
    case PriceDescending = 'price_descending';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Name => 'Name',
            self::PriceAscending => 'Price Ascending',
            self::PriceDescending => 'Price Descending',
        };
    }
}
