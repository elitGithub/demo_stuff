<?php

namespace Database\Seeders;

use Carbon\CarbonImmutable;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Throwable;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * @return void
     *
     * @throws Throwable
     */
    public function run(): void
    {
        $seededAt = CarbonImmutable::now()->startOfSecond();

        DB::transaction(function () use ($seededAt): void {
            $this->call([OwnerSeeder::class, TrackedSenderSeeder::class]);
            $this->call([CaseSeeder::class, MailboxSeeder::class], parameters: ['seededAt' => $seededAt]);
            $this->call(ScriptSeeder::class);
            $this->call(InstallationSeeder::class, parameters: ['seededAt' => $seededAt]);
        });
    }
}
