<?php

use Monolog\Handler\NullHandler;

return [
    'default' => env('LOG_CHANNEL', 'errorlog'),
    'deprecations' => [
        'channel' => 'null',
        'trace' => false,
    ],
    'channels' => [
        'bounded' => [
            'driver' => 'monolog',
            'handler' => App\Logging\BoundedFileHandler::class,
            'level' => 'warning',
        ],
        'errorlog' => [
            'driver' => 'errorlog',
            'level' => 'warning',
            'replace_placeholders' => true,
        ],
        'null' => [
            'driver' => 'monolog',
            'handler' => NullHandler::class,
        ],
        'emergency' => [
            'path' => 'php://stderr',
        ],
    ],
];
