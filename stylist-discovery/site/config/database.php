<?php

return [
    'default' => 'visitor',
    'connections' => [
        'visitor' => [
            'driver' => 'unbound-visitor',
            'database' => null,
            'prefix' => '',
        ],
        'registry' => [
            'driver' => 'sqlite',
            'database' => env('DEMO_REGISTRY_PATH', storage_path('app/demo-runtime/registry.sqlite')),
            'prefix' => '',
            'foreign_key_constraints' => true,
            'busy_timeout' => 2000,
            'journal_mode' => 'DELETE',
            'synchronous' => 'FULL',
            'transaction_mode' => 'IMMEDIATE',
            'options' => [PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READWRITE],
        ],
    ],
    'migrations' => [
        'table' => 'migrations',
        'update_date_on_publish' => true,
    ],
];
