<?php

use App\Http\Middleware\BindSandbox;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Http\Request;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$input = json_decode($argv[1], true, flags: JSON_THROW_ON_ERROR);
$root = $input['root'];
$testing = dirname(__DIR__, 2).'/storage/framework/testing/';
if (preg_match('/\A'.preg_quote($testing, '/').'[0-9a-f]{32}\/fixtures\z/', $root) !== 1 || realpath($root) !== $root || is_link($root)) {
    throw new RuntimeException('Worker refuses an unowned fixture.');
}
$application = require dirname(__DIR__, 2).'/bootstrap/app.php';
$application->loadEnvironmentFrom('.env.testing');
$application->make(Kernel::class)->bootstrap();
config(['demo.runtime_path' => $root, 'demo.template_path' => $root.'/template.sqlite']);
$service = app(SandboxService::class);
$service->prepareRegistry();
$session = new Store('worker', new ArraySessionHandler(240));
$session->start();
$session->put($input['session']);
$request = Request::create('/demo/ready');
$request->setLaravelSession($session);
file_put_contents($root.'/'.$input['signal'].'-started', 'started');
try {
    if ($input['operation'] === 'uploads') {
        $service->reclaimUploads(CarbonImmutable::parse($input['now']));
        echo json_encode(['status' => 200], JSON_THROW_ON_ERROR);
    } elseif ($input['operation'] === 'cleanup') {
        $result = $service->reclaim(CarbonImmutable::parse($input['now'])->addHours(5));
        echo json_encode(['reclaimed' => $result], JSON_THROW_ON_ERROR);
    } else {
        (new BindSandbox)->handle($request, function () use ($input, $root): Response {
            file_put_contents($root.'/'.$input['signal'], 'admitted');
            if ($input['operation'] === 'hold') {
                $deadline = microtime(true) + 10;
                while (! file_exists($root.'/release') && microtime(true) < $deadline) {
                    usleep(10000);
                }
                if (! file_exists($root.'/release')) {
                    throw new RuntimeException('Barrier timed out.');
                }
            }

            return new Response('complete');
        });
        echo json_encode(['status' => 200], JSON_THROW_ON_ERROR);
    }
} catch (HttpException $exception) {
    echo json_encode(['status' => $exception->getStatusCode(), 'headers' => $exception->getHeaders()], JSON_THROW_ON_ERROR);
}
