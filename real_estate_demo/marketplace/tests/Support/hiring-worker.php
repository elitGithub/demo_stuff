<?php

use App\Actions\Quotes\AcceptQuote;
use App\Exceptions\WorkflowConflict;
use App\Models\Category;
use App\Models\JobEvent;
use App\Models\ProviderProfile;
use App\Models\Quote;
use App\Models\ServiceRequest;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

// Each process validates its dedicated fixture path before loading the application.
$base = dirname(__DIR__, 2);
$path = $argv[2] ?? '';
$root = realpath($base.'/storage/framework/testing');
if (getenv('HAVEN_CONCURRENCY_APPROVED') !== '1' || getenv('APP_ENV') !== 'testing' || getenv('MODE') !== 'testing'
    || $root === false || realpath(dirname($path)) !== $root || is_link($path)
    || ! preg_match('/^hiring-[a-f0-9]{16}\.sqlite$/D', basename($path))
    || ! is_file($path) || getenv('DB_DATABASE') !== $path
    || is_file($base.'/bootstrap/cache/config.php')
    || (getenv('APP_CONFIG_CACHE') && is_file(getenv('APP_CONFIG_CACHE')))) {
    fwrite(STDERR, 'Unsafe concurrency worker environment.');
    exit(1);
}
require $base.'/vendor/autoload.php';

try {
    $app = require $base.'/bootstrap/app.php';
    $kernel = $app->make(Kernel::class);
    $kernel->bootstrap();
    if (config('database.default') !== 'sqlite' || config('database.connections.sqlite.database') !== $path
        || config('database.connections.sqlite.url') || config('demo.read_only')) {
        throw new RuntimeException('Resolved database is not the isolated fixture.');
    }
    DB::statement('PRAGMA busy_timeout = 5000');
    $mode = $argv[1];
    $payload = json_decode($argv[3], true, flags: JSON_THROW_ON_ERROR);
    if ($mode === 'prepare') {
        DB::statement('PRAGMA journal_mode = WAL');
        if ($kernel->call('migrate', ['--force' => true, '--no-interaction' => true]) !== 0) {
            throw new RuntimeException('Fixture migration failed.');
        }
        $category = Category::factory()->create();
        $customer = User::factory()->customer()->create();
        $job = ServiceRequest::factory()->create(['customer_id' => $customer->id, 'category_id' => $category->id, 'status' => 'open', 'service_area' => 'Austin']);
        $quotes = [];
        for ($i = 0; $i < 2; $i++) {
            $provider = User::factory()->provider()->create();
            $profile = ProviderProfile::factory()->create(['user_id' => $provider->id, 'status' => 'approved', 'service_areas' => ['Austin']]);
            $profile->categories()->attach($category);
            $quotes[] = Quote::factory()->create(['service_request_id' => $job->id, 'provider_id' => $provider->id, 'status' => 'pending', 'version' => 1])->id;
        }
        $result = ['customer_id' => $customer->id, 'request_id' => $job->id, 'first_quote_id' => $quotes[0], 'second_quote_id' => $quotes[1]];
    } elseif ($mode === 'accept') {
        if (! in_array($payload['slot'], [0, 1], true)) {
            throw new RuntimeException('Invalid worker slot.');
        }
        $actor = User::findOrFail($payload['customer_id']);
        $quote = Quote::findOrFail($payload['quote_id']);
        file_put_contents($path.'.ready-'.$payload['slot'], 'ready');
        $deadline = microtime(true) + 5;
        while (! is_file($path.'.go')) {
            if (microtime(true) > $deadline) {
                throw new RuntimeException('Hiring barrier timed out.');
            }
            usleep(10000);
        }
        try {
            app(AcceptQuote::class)->handle($actor, $quote, 1);
            $result = ['status' => 200];
        } catch (WorkflowConflict $exception) {
            $result = ['status' => 409];
        }
    } elseif ($mode === 'inspect') {
        $result = [
            'accepted_quote_id' => ServiceRequest::sole()->accepted_quote_id,
            'accepted_count' => Quote::where('status', 'accepted')->count(),
            'booked_event_count' => JobEvent::where('type', 'booked')->count(),
        ];
    } else {
        throw new RuntimeException('Unknown worker mode.');
    }
    echo json_encode($result, JSON_THROW_ON_ERROR);
} catch (Throwable $exception) {
    fwrite(STDERR, get_class($exception).': '.$exception->getMessage());
    exit(1);
}
