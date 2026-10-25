<?php

$applicationRoot = dirname(__DIR__);
$configuredCache = getenv('APP_CONFIG_CACHE');

if (file_exists($applicationRoot.'/bootstrap/cache/config.php') ||
    ($configuredCache !== false && $configuredCache !== '' && file_exists($configuredCache))) {
    throw new RuntimeException('Tests refuse cached application configuration.');
}

putenv('APP_ENV=testing');
$_ENV['APP_ENV'] = 'testing';
$_SERVER['APP_ENV'] = 'testing';

require $applicationRoot.'/vendor/autoload.php';
