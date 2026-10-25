<?php

return [
    'default' => 'database',
    'stores' => [
        'database' => [
            'driver' => 'database',
            'connection' => 'registry',
            'table' => 'cache',
            'lock_connection' => 'registry',
            'lock_table' => 'cache_locks',
            'lock_lottery' => [0, 100],
        ],
        'array' => [
            'driver' => 'array',
            'serialize' => false,
        ],
    ],
    'prefix' => 'strand-city',
];
