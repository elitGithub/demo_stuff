<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Service;
use App\Models\Stylist;
use Illuminate\Support\Facades\DB;
use Symfony\Component\Process\Process;
use Tests\TestCase;

class BookingConcurrencyTest extends TestCase
{
    public function test_two_independent_workers_cannot_reserve_the_same_stylist_time(): void
    {
        $database = tempnam(sys_get_temp_dir(), 'studio-test-db-');
        $payload = tempnam(sys_get_temp_dir(), 'studio-test-booking-');
        $original = config('database.connections.sqlite.database');
        config(['database.connections.sqlite.database' => $database]);
        DB::purge('sqlite');
        $workers = [];

        try {
            $this->artisan('migrate', ['--force' => true])->assertSuccessful();
            $service = Service::create(['name' => 'Cut', 'category' => 'Hair', 'price' => 5000, 'duration' => 45]);
            $stylist = Stylist::create(['name' => 'Alex', 'title' => 'Stylist', 'working_days' => [0, 1, 2, 3, 4, 5, 6]]);
            $stylist->services()->attach($service);
            file_put_contents($payload, json_encode(['name' => 'Concurrency fixture', 'stylist_id' => $stylist->id, 'service_ids' => [$service->id], 'date' => now(config('studio.timezone'))->addDays(2)->format('Y-m-d'), 'time' => '11:00']));

            for ($i = 0; $i < 2; $i++) {
                $worker = new Process([PHP_BINARY, '-d', 'opcache.jit=0', base_path('tests/Fixtures/book-visit.php'), $payload], base_path(), ['APP_ENV' => 'testing', 'DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => $database, 'DB_URL' => '', 'CACHE_STORE' => 'array']);
                $worker->setTimeout(20)->start();
                $workers[] = $worker;
            }
            $results = [];
            foreach ($workers as $worker) {
                $worker->wait();
                $this->assertTrue($worker->isSuccessful(), $worker->getErrorOutput());
                $results[] = trim($worker->getOutput());
            }
            sort($results);
            $this->assertSame(['booked', 'conflict'], $results);
            $this->assertSame(1, Appointment::count());
        } finally {
            foreach ($workers as $worker) {
                if ($worker->isRunning()) {
                    $worker->stop();
                }
            }
            DB::purge('sqlite');
            config(['database.connections.sqlite.database' => $original]);
            @unlink($database);
            @unlink($database.'-wal');
            @unlink($database.'-shm');
            @unlink($payload);
        }
    }
}
