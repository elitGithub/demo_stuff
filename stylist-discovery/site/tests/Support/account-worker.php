<?php

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$input = json_decode($argv[1], true, flags: JSON_THROW_ON_ERROR);
$root = $input['root'];
$testing = dirname(__DIR__, 2).'/storage/framework/testing/';
if (preg_match('/\A'.preg_quote($testing, '/').'[0-9a-f]{32}\/fixtures\z/', $root) !== 1 || realpath($root) !== $root || is_link($root)) {
    throw new RuntimeException('Worker refuses an unowned account fixture.');
}
$application = require dirname(__DIR__, 2).'/bootstrap/app.php';
$application->loadEnvironmentFrom('.env.testing');
$kernel = $application->make(Kernel::class);
$kernel->bootstrap();
config(['demo.runtime_path' => $root, 'demo.template_path' => $root.'/template.sqlite', 'session.secure' => false, 'session.path' => '/']);
$deadline = microtime(true) + 8;
file_put_contents($root.'/'.$input['signal'], 'ready');
while (! file_exists($root.'/go') && microtime(true) < $deadline) {
    usleep(10000);
}
if (! file_exists($root.'/go')) {
    throw new RuntimeException('Account request barrier timed out.');
}
$request = Request::create('http://localhost/demo/role', 'POST', ['role' => 'stylist', '_actor_context' => $input['context']], ['strand_city_session' => $input['cookie']], server: ['REMOTE_ADDR' => '192.0.2.10']);
$response = $kernel->handle($request);
$kernel->terminate($request, $response);
echo json_encode(['status' => $response->getStatusCode(), 'cookies' => count($response->headers->getCookies())], JSON_THROW_ON_ERROR);
