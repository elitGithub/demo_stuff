<?php

return [
    'name' => env('STUDIO_NAME', 'Atelier'),
    'timezone' => env('STUDIO_TIMEZONE', 'Asia/Jerusalem'),
    'currency' => env('STUDIO_CURRENCY', 'USD'),
    'tax_percent' => (int) env('STUDIO_TAX_PERCENT', 0),
    'demo' => (bool) env('STUDIO_DEMO', false),
    'public_demo' => (bool) env('STUDIO_PUBLIC_DEMO', false),
    'demo_email' => env('STUDIO_DEMO_EMAIL', 'hello@atelier.example'),
    'demo_password' => env('STUDIO_DEMO_PASSWORD'),
    'address' => env('STUDIO_ADDRESS', '24 Olive Street, The Creative Quarter'),
    'phone' => env('STUDIO_PHONE', '+1 (555) 010-2400'),
    'reminders' => 'preview',
    'stripe_enabled' => false,
];
