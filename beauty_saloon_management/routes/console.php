<?php

use App\Models\Client;
use App\Models\User;
use App\Services\ReminderService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('reminders:process', function (ReminderService $reminders) {
    $this->info($reminders->processDue().' reminders simulated. No messages sent.');
})->purpose('Process due email, SMS and WhatsApp reminder previews');

Schedule::command('reminders:process')->everyMinute()->withoutOverlapping();

Artisan::command('studio:prepare-demo', function () {
    if (! config('studio.demo')) {
        $this->error('Set STUDIO_DEMO=true in a local demo environment first. No database changes were made.');

        return 1;
    }
    if (config('database.default') !== 'sqlite') {
        $this->error('Automatic demo setup supports SQLite only. Configure and migrate other databases manually.');

        return 1;
    }
    if (! config('app.key')) {
        $this->call('key:generate');
    }
    $database = config('database.connections.sqlite.database');
    if ($database !== ':memory:' && ! file_exists($database)) {
        touch($database);
    }
    $this->call('migrate', ['--force' => true]);
    if (User::exists() || Client::exists()) {
        $this->info('Existing records preserved. Demo seed skipped.');
    } else {
        $this->call('db:seed', ['--force' => true]);
    }
    $this->info('Open /login and choose Explore the demo. No outbound integrations are enabled.');

    return 0;
})->purpose('Prepare a local SQLite demo without resetting existing records');

Schedule::command('outreach:process')->hourly()->withoutOverlapping();
