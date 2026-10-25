<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$privateRoot = __DIR__.'/_app';
$configurationPath = $privateRoot.'/private-config.php';
$configuration = is_file($configurationPath) && ! is_link($configurationPath) ? require $configurationPath : null;
$key = is_array($configuration) ? ($configuration['APP_KEY'] ?? '') : '';
$url = is_array($configuration) ? ($configuration['APP_URL'] ?? '') : '';
$valid = is_string($key) && str_starts_with($key, 'base64:') && strlen((string) base64_decode(substr($key, 7), true)) === 32 && $key !== 'base64:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
$valid = $valid && is_string($url) && preg_match('~\Ahttps://[a-z0-9.-]+/stylist-discovery\z~D', $url) === 1;
$valid = $valid && PHP_VERSION_ID >= 80400 && extension_loaded('pdo_sqlite') && extension_loaded('gd') && in_array('argon2id', password_algos(), true);

foreach (['LARAVEL_STORAGE_PATH' => '/storage', 'DEMO_RUNTIME_PATH' => '/storage/app/demo-runtime', 'DEMO_TEMPLATE_PATH' => '/storage/app/demo-runtime/template.sqlite', 'DEMO_REGISTRY_PATH' => '/storage/app/demo-runtime/registry.sqlite'] as $name => $suffix) {
    $expected = $privateRoot.$suffix;
    $value = is_array($configuration) ? ($configuration[$name] ?? null) : null;
    $valid = $valid && is_string($value) && $value === $expected && realpath($expected) === $expected && ! is_link($expected);
}
foreach (['/storage/framework/views', '/storage/framework/cache/data', '/storage/framework/sessions', '/storage/logs', '/storage/app/demo-runtime'] as $suffix) {
    $valid = $valid && is_dir($privateRoot.$suffix) && is_writable($privateRoot.$suffix);
}
if (! $valid) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=UTF-8');
    header('Cache-Control: no-store');
    exit('The demonstration is awaiting its private hosting configuration.');
}

$environment = [
    'APP_ENV' => 'production', 'APP_DEBUG' => 'false', 'APP_KEY' => $key, 'APP_URL' => $url,
    'LARAVEL_STORAGE_PATH' => $configuration['LARAVEL_STORAGE_PATH'],
    'DEMO_RUNTIME_PATH' => $configuration['DEMO_RUNTIME_PATH'],
    'DEMO_TEMPLATE_PATH' => $configuration['DEMO_TEMPLATE_PATH'],
    'DEMO_REGISTRY_PATH' => $configuration['DEMO_REGISTRY_PATH'],
    'VIEW_COMPILED_PATH' => $privateRoot.'/storage/framework/views',
    'APP_CONFIG_CACHE' => $privateRoot.'/storage/framework/cache/config.php',
    'APP_EVENTS_CACHE' => $privateRoot.'/storage/framework/cache/events.php',
    'APP_ROUTES_CACHE' => $privateRoot.'/storage/framework/cache/routes.php',
    'APP_SERVICES_CACHE' => $privateRoot.'/storage/framework/cache/services.php',
    'APP_PACKAGES_CACHE' => $privateRoot.'/storage/framework/cache/packages.php',
    'SESSION_PATH' => '/stylist-discovery', 'SESSION_SECURE_COOKIE' => 'true', 'LOG_CHANNEL' => 'bounded',
];
foreach ($environment as $name => $value) {
    $_ENV[$name] = $value;
    $_SERVER[$name] = $value;
    putenv($name.'='.$value);
}

require $privateRoot.'/vendor/autoload.php';
$application = require $privateRoot.'/bootstrap/app.php';
$application->useStoragePath($configuration['LARAVEL_STORAGE_PATH']);
$application->handleRequest(Request::capture());
