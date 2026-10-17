<?php

namespace App\Enums;

enum IllustrationMotif: string
{
    case KitchenSink = 'kitchen_sink';
    case Thermostat = 'thermostat';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::KitchenSink => 'Kitchen sink',
            self::Thermostat => 'Thermostat',
        };
    }
}
