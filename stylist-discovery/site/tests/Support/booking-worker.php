<?php

use App\Enums\CheckoutOutcome;
use App\Models\Booking;
use App\Models\User;
use App\Services\BookingService;
use App\Services\FixtureService;
use App\Services\PaymentService;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Database\QueryException;
use Symfony\Component\HttpKernel\Exception\HttpException;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$input = json_decode($argv[1], true, flags: JSON_THROW_ON_ERROR);
$root = $input['root'];
$testing = dirname(__DIR__, 2).'/storage/framework/testing/';
if (preg_match('/\A'.preg_quote($testing, '/').'[0-9a-f]{32}\/fixtures\z/', $root) !== 1 || realpath($root) !== $root || is_link($root) || dirname($input['database']) !== $root || ! is_file($input['database']) || is_link($input['database'])) {
    throw new RuntimeException('Worker refuses an unowned booking fixture.');
}
$application = require dirname(__DIR__, 2).'/bootstrap/app.php';
$application->loadEnvironmentFrom('.env.testing');
$application->make(Kernel::class)->bootstrap();
app(FixtureService::class)->configureConnection('visitor', $input['database'], config('demo.limits.visitor_pages'));
file_put_contents($root.'/'.$input['signal'], 'ready');
$deadline = microtime(true) + 8;
$barrier = $input['barrier'] ?? 'booking-go';
while (! file_exists($root.'/'.$barrier) && microtime(true) < $deadline) {
    usleep(10000);
}
if (! file_exists($root.'/'.$barrier)) {
    throw new RuntimeException('Booking barrier timed out.');
}
try {
    $booking = Booking::query()->findOrFail($input['booking']);
    $actor = User::query()->findOrFail($input['actor']);
    $now = CarbonImmutable::parse($input['now']);
    match ($input['action'] ?? 'accept') {
        'accept' => app(BookingService::class)->accept($actor, $booking, $now),
        'checkout' => app(PaymentService::class)->checkout($actor, $booking, CheckoutOutcome::Succeeded, $now),
        'cancel' => app(BookingService::class)->cancel($actor, $booking, null, $now),
        'expire' => app(BookingService::class)->expireFor($booking->profile, $now),
    };
    echo json_encode(['status' => 200], JSON_THROW_ON_ERROR);
} catch (HttpException $exception) {
    echo json_encode(['status' => $exception->getStatusCode()], JSON_THROW_ON_ERROR);
} catch (QueryException $exception) {
    $mapped = app(SandboxService::class)->storageException($exception);
    if (! $mapped instanceof HttpException || $mapped->getStatusCode() !== 503) {
        throw $mapped;
    }
    echo json_encode(['status' => 503], JSON_THROW_ON_ERROR);
}
