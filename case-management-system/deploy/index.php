<?php

use Illuminate\Foundation\Application;
use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

if (file_exists($maintenance = __DIR__.'/_app/storage/framework/maintenance.php')) {
    require $maintenance;
}

require __DIR__.'/_app/vendor/autoload.php';

/** @var Application $app */
$app = require_once __DIR__.'/_app/bootstrap/app.php';
$app->usePublicPath(__DIR__);
$app->handleRequest(Request::capture());
