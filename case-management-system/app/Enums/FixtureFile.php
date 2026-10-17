<?php

namespace App\Enums;

use Illuminate\Support\Facades\File;
use RuntimeException;

enum FixtureFile: string
{
    case SnowClearingQuote = 'snow-clearing-quote.pdf';
    case FurnaceFilterInvoice = 'furnace-filter-invoice.pdf';
    case KitchenSinkLeak = 'kitchen-sink-leak.png';
    case ThermostatError = 'thermostat-error.png';

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::SnowClearingQuote => 'Snow clearing quote',
            self::FurnaceFilterInvoice => 'Furnace filter invoice',
            self::KitchenSinkLeak => 'Kitchen sink leak photo',
            self::ThermostatError => 'Thermostat error photo',
        };
    }

    /**
     * @return string
     */
    public function mimeType(): string
    {
        return match ($this) {
            self::SnowClearingQuote, self::FurnaceFilterInvoice => 'application/pdf',
            self::KitchenSinkLeak, self::ThermostatError => 'image/png',
        };
    }

    /**
     * @return string
     */
    public function path(): string
    {
        return config('casefile.attachments.directory').DIRECTORY_SEPARATOR.$this->value;
    }

    /**
     * @return int
     *
     * @throws RuntimeException
     */
    public function sizeBytes(): int
    {
        $path = $this->path();

        if (! is_file($path)) {
            throw new RuntimeException('Fixture file missing at '.$path.'; run php artisan casefile:build-fixtures first.');
        }

        return File::size($path);
    }
}
