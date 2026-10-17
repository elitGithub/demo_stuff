<?php

namespace App\Enums;

use ValueError;

enum CasefileMode: string
{
    case Local = 'local';
    case Demo = 'demo';
    case Production = 'production';

    /**
     * @return self
     *
     * @throws ValueError
     */
    public static function current(): self
    {
        $configured = config('casefile.mode');
        $mode = is_string($configured) ? self::tryFrom($configured) : null;

        if ($mode === null) {
            throw new ValueError(sprintf(
                'Unknown CASEFILE_MODE %s. Use one of: %s.',
                is_string($configured) ? '"'.$configured.'"' : '('.get_debug_type($configured).')',
                implode(', ', array_column(self::cases(), 'value')),
            ));
        }

        return $mode;
    }

    /**
     * @return bool
     */
    public function demoControlsEnabled(): bool
    {
        return match ($this) {
            self::Local, self::Demo => true,
            self::Production => false,
        };
    }

    /**
     * @return bool
     */
    public function usesSandboxes(): bool
    {
        return match ($this) {
            self::Demo => true,
            self::Local, self::Production => false,
        };
    }

    /**
     * @return string
     */
    public function label(): string
    {
        return match ($this) {
            self::Local => 'Local',
            self::Demo => 'Demo',
            self::Production => 'Production',
        };
    }
}
