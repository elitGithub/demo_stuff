<?php
declare(strict_types=1);
ini_set('display_errors','0');
$path=rtrim(parse_url($_SERVER['REQUEST_URI']??'/',PHP_URL_PATH)?:'/','/')?:'/';
if(in_array($path,['/api/data.php','/RestroGirls/api/data.php'],true)) {
    http_response_code(410); header('Content-Type: application/json'); header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
    echo '{"error":"This endpoint has been permanently removed."}'; exit;
}
try {
    require dirname(__DIR__).'/app/bootstrap.php';
    require dirname(__DIR__).'/app/Http.php';
    (new Http())->run($path,$_SERVER['REQUEST_METHOD']??'GET');
} catch(Throwable $e) {
    error_log('Restaurant application: '.$e->getMessage());
    http_response_code(503);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Temporarily unavailable</title><h1>We’ll be right back.</h1><p>The restaurant is temporarily unavailable. Please try again shortly.</p></html>';
}
