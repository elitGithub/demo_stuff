<?php

namespace App\Services;

use App\Enums\BookingStatus;
use App\Enums\InboxEvent;
use App\Models\Booking;
use App\Models\SandboxMeta;
use Carbon\CarbonImmutable;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;
use PDO;
use RuntimeException;

class FixtureService
{
    /**
     * @param  string  $outputDirectory
     * @return void
     *
     * @throws RuntimeException
     */
    public function build(string $outputDirectory): void
    {
        $directory = str_starts_with($outputDirectory, '/') ? $outputDirectory : base_path($outputDirectory);
        $segments = [];

        foreach (explode('/', $directory) as $segment) {
            if ($segment === '..') {
                array_pop($segments);
            } elseif ($segment !== '' && $segment !== '.') {
                $segments[] = $segment;
            }

            $ancestor = '/'.implode('/', $segments);

            if (is_link($ancestor)) {
                throw new RuntimeException('Fixture paths cannot contain symbolic links.');
            }
        }

        $directory = '/'.implode('/', $segments);
        $allowedRoot = app()->environment('testing') ? base_path('storage/framework/testing').'/' : dirname(base_path()).'/';

        if (! str_starts_with($directory.'/', $allowedRoot) || file_exists($directory)) {
            throw new RuntimeException('Fixture output must be a new directory inside the approved demo root.');
        }

        if (! mkdir($directory, 0700, true)) {
            throw new RuntimeException('Cannot create fixture output.');
        }

        $originalVisitor = config('database.connections.visitor');
        $originalRegistry = config('database.connections.registry');

        try {
            foreach (['registry' => 'registry.sqlite', 'visitor' => 'template.sqlite'] as $name => $filename) {
                $path = $directory.'/'.$filename;
                $handle = fopen($path, 'x');

                if ($handle === false) {
                    throw new RuntimeException('Cannot create a new fixture database.');
                }

                fclose($handle);
                $this->configureConnection($name, $path, config('demo.limits.'.$name.'_pages'));
                $migrationDirectory = database_path('migrations/'.($name === 'registry' ? 'registry' : 'visitor'));

                foreach (glob($migrationDirectory.'/*.php') as $migrationPath) {
                    (require $migrationPath)->up();
                }
            }

            DB::connection('visitor')->transaction(function (): void {
                (new DemoSeeder)->run();
            });
        } finally {
            DB::purge('visitor');
            DB::purge('registry');
            config(['database.connections.visitor' => $originalVisitor, 'database.connections.registry' => $originalRegistry]);
        }
    }

    /**
     * @param  string  $name
     * @param  string  $path
     * @param  int  $maximumPages
     * @return void
     *
     * @throws RuntimeException
     */
    public function configureConnection(string $name, string $path, int $maximumPages): void
    {
        if (! in_array($name, ['visitor', 'registry'], true) || ! is_file($path) || is_link($path)) {
            throw new RuntimeException('Fixture connection requires an existing owned database.');
        }

        DB::purge($name);
        config(['database.connections.'.$name => [
            'driver' => 'sqlite', 'database' => $path, 'prefix' => '', 'foreign_key_constraints' => true,
            'busy_timeout' => config('demo.sqlite.busy_timeout'), 'journal_mode' => 'DELETE',
            'synchronous' => 'FULL', 'transaction_mode' => 'IMMEDIATE',
            'options' => [PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READWRITE],
        ]]);
        $connection = DB::connection($name);
        $connection->statement('PRAGMA page_size = '.config('demo.sqlite.page_size'));
        $connection->statement('PRAGMA max_page_count = '.$maximumPages);
        $connection->statement('PRAGMA temp_store = MEMORY');
    }

    /**
     * @param  CarbonImmutable  $now
     * @return void
     *
     * @throws RuntimeException
     */
    public function initializeVisitor(CarbonImmutable $now): void
    {
        DB::connection('visitor')->transaction(function () use ($now): void {
            $meta = SandboxMeta::query()->sole();

            if ($meta->seed_anchor !== null) {
                throw new RuntimeException('Only a pristine template copy can be initialized.');
            }

            foreach (Booking::query()->whereNotNull('seed_key')->orderBy('id')->get() as $booking) {
                $definition = config('demo.seed.bookings.'.$booking->seed_key);
                $startsAt = $now->setTimezone($booking->timezone)->addDays($definition['days'])->setTime($definition['hour'], 0)->utc();
                $acceptedAt = match ($booking->status) {
                    BookingStatus::Requested => null,
                    BookingStatus::AwaitingDeposit => $now->utc(),
                    BookingStatus::Confirmed => $now->utc()->subHour(),
                    BookingStatus::Completed => $startsAt->subDay(),
                };
                $requestedAt = $booking->status === BookingStatus::Completed ? $startsAt->subDays(2) : $now->utc()->subHours(2);
                $booking->update([
                    'starts_at' => $startsAt, 'ends_at' => $startsAt->addMinutes($booking->duration_minutes),
                    'accepted_at' => $acceptedAt,
                    'deposit_deadline' => $acceptedAt?->addMinutes(config('demo.booking.hold_minutes'))->min($startsAt),
                    'created_at' => $requestedAt, 'updated_at' => $acceptedAt ?? $requestedAt,
                ]);
                $booking->payments()->update(['created_at' => $acceptedAt, 'updated_at' => $acceptedAt]);
                $booking->messages()->where('event', InboxEvent::RequestReceived)->update(['created_at' => $requestedAt, 'updated_at' => $requestedAt]);
                $booking->messages()->where('event', '!=', InboxEvent::RequestReceived)->update(['created_at' => $acceptedAt, 'updated_at' => $acceptedAt]);
            }

            $meta->update(['seed_anchor' => $now->utc()]);
        });
    }
}
