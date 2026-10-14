<?php

return [
    'read_only_environments' => ['demo'],
    'demo' => (bool) env('TURNKEY_DEMO', false),
    'name' => env('APP_NAME', 'Turnkey CRM'),
    'company' => env('TURNKEY_COMPANY', 'Turnkey Services'),
    'company_email' => env('TURNKEY_COMPANY_EMAIL', 'hello@turnkey.example'),
    'company_address' => env('TURNKEY_COMPANY_ADDRESS', 'Independent services for growing businesses'),
    'demo_email' => 'demo@turnkey.example',
    'demo_password' => env('TURNKEY_DEMO_PASSWORD', 'TurnkeyDemo!2026'),
];
