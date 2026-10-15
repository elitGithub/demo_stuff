<?php

return [
    'read_only_environments' => ['demo'],
    'demo' => (bool) env('TURNKEY_DEMO', false),
    'shared_hosting' => (bool) env('TURNKEY_SHARED_HOSTING', false),
    'name' => env('APP_NAME', 'CustomCRM'),
    'company' => env('TURNKEY_COMPANY', 'CustomCRM Services'),
    'company_email' => env('TURNKEY_COMPANY_EMAIL', 'hello@customcrm.example'),
    'company_address' => env('TURNKEY_COMPANY_ADDRESS', 'Independent services for growing businesses'),
    'demo_email' => 'demo@customcrm.example',
    'demo_password' => env('TURNKEY_DEMO_PASSWORD', 'CustomCRMDemo!2026'),
];
