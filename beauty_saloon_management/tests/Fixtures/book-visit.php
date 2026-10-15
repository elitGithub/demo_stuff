<?php

use App\Services\BookingService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Validation\ValidationException;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

try {
    app(BookingService::class)->book(json_decode(file_get_contents($argv[1]), true, flags: JSON_THROW_ON_ERROR));
    echo 'booked';
} catch (ValidationException $exception) {
    if (! array_key_exists('time', $exception->errors())) {
        throw $exception;
    }
    echo 'conflict';
}
