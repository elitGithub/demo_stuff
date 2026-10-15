<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$private = __DIR__.'/_app';

// Gate the application before Laravel can open a database connection.
require $private.'/setup-access.php';

if (file_exists($maintenance = $private.'/storage/framework/maintenance.php')) {
    require $maintenance;
}

require $private.'/vendor/autoload.php';

$app = require_once $private.'/bootstrap/app.php';
$app->usePublicPath(__DIR__);
$app->handleRequest(Request::capture());
