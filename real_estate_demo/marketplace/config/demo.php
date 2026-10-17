<?php

$mode = strtolower((string) env('MODE', env('mode', env('APP_ENV', 'production'))));

return [
    'mode' => $mode,
    'read_only' => $mode === 'demo',
    'enabled' => (bool) env('DEMO_ENABLED', $mode === 'demo'),
    'environments' => ['local', 'demo', 'testing'],
    'actors' => ['customer', 'provider', 'admin'],
];
