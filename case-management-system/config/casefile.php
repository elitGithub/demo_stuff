<?php

return [

    'mode' => env('CASEFILE_MODE', 'local'),

    'owner' => [
        'name' => 'Dana Whitfield',
        'email' => 'dana@casefile.example',
    ],

    'sign_in' => [
        'attempts_per_minute' => 10,
    ],

    'notifications' => [
        'name' => 'Casefile',
        'email' => 'notifications@casefile.example',
    ],

    'actions' => [
        'attempts_per_minute' => 30,
    ],

    'sandbox' => [
        'directory' => storage_path('app/sandboxes'),
        'template' => storage_path('app/template/casefile-template.sqlite'),
        'ttl_hours' => 24,
        'cap' => 50,
        'provisions_per_hour' => 5,
        'session_key' => 'casefile_sandbox',
    ],

    'layout' => [
        'cookie' => 'casefile_layout',
        'default' => 'desk',
    ],

    'demo' => [
        'attempts_per_minute' => 30,
        'auto_reply_delay_seconds' => 20,
    ],

    'attachments' => [
        'directory' => database_path('fixtures/attachments'),
        'inline_types' => [
            'image/png',
            'image/jpeg',
            'image/gif',
            'image/webp',
            'application/pdf',
            'text/plain',
        ],
    ],

];
