<?php

namespace Elsewhere;

enum Asset: string
{
    case Styles = 'styles.css';
    case Sandbox = 'sandbox.js';
    case DashboardPagination = 'dashboard-pagination.js';
    case App = 'app.js';
    case Admin = 'admin.js';

    /** @return string */
    public function label(): string
    {
        return match ($this) {
            self::Styles => 'Site styles',
            self::Sandbox => 'Sandbox client',
            self::DashboardPagination => 'Dashboard pagination',
            self::App => 'Site script',
            self::Admin => 'Dashboard script',
        };
    }

    /**
     * @return string
     * @throws \RuntimeException
     */
    public function url(): string
    {
        $hash = hash_file('sha256', dirname(__DIR__, 2).'/assets/'.$this->value);
        if ($hash === false) {
            throw new \RuntimeException('Unreadable asset '.$this->value.'.');
        }

        return 'assets/'.$this->value.'?v='.substr($hash, 0, 10);
    }
}
