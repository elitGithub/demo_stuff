<?php

namespace Database\Seeders;

use App\Models\CaseNumberSequence;
use App\Models\CaseRecord;
use App\Models\InstallationMeta;
use App\Models\MailboxMessage;
use Carbon\CarbonImmutable;
use Illuminate\Database\Migrations\Migrator;
use Illuminate\Database\Seeder;

class InstallationSeeder extends Seeder
{
    /**
     * @param  Migrator  $migrator
     * @param  CarbonImmutable  $seededAt
     * @return void
     */
    public function run(Migrator $migrator, CarbonImmutable $seededAt): void
    {
        InstallationMeta::query()->create([
            'schema_version' => array_key_last($migrator->getMigrationFiles(database_path('migrations'))),
            'seeded_at' => $seededAt,
            'dates_shifted_to' => null,
            'mailbox_cursor' => (string) MailboxMessage::query()->max('id'),
        ]);

        CaseNumberSequence::query()->create([
            'next_number' => CaseRecord::query()->count() + 1,
        ]);
    }
}
