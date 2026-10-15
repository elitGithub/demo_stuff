<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class BackupStudio extends Command
{
    protected $signature = 'studio:backup';

    protected $description = 'Create a private SQLite snapshot and copy business uploads; excludes credentials';

    public function handle(): int
    {
        if (DB::connection()->getDriverName() !== 'sqlite') {
            $this->error('Use your database provider’s consistent backup tooling for non-SQLite installations.');

            return self::FAILURE;
        }
        $disk = Storage::disk('local');
        $folder = 'backups/'.now()->format('Ymd-His').'-'.Str::random(8);
        try {
            if (! $disk->makeDirectory($folder) || ! chmod($disk->path($folder), 0700)) {
                throw new \RuntimeException('Cannot create a private backup directory.');
            }
            $snapshot = $disk->path($folder.'/database.sqlite');
            DB::connection()->getPdo()->exec('VACUUM INTO '.DB::connection()->getPdo()->quote($snapshot));
            if (! chmod($snapshot, 0600)) {
                throw new \RuntimeException('Cannot protect the database snapshot.');
            }
            $copied = [];
            foreach ($disk->allFiles() as $file) {
                if (! str_starts_with($file, 'styles/') && ! str_starts_with($file, 'pipeline/')) {
                    continue;
                }
                if (! $disk->copy($file, $folder.'/files/'.$file)) {
                    throw new \RuntimeException('Cannot copy a business upload into the backup.');
                }
                $copied[] = $file;
            }
            if (! $disk->put($folder.'/manifest.json', json_encode(['created_at' => now()->toIso8601String(), 'database' => 'database.sqlite', 'files' => $copied, 'database_sha256' => hash_file('sha256', $snapshot), 'note' => 'Pause writes during backup for consistent database/upload references. APP_KEY and .env are deliberately excluded.'], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR))) {
                throw new \RuntimeException('Cannot write the backup manifest.');
            }
            $this->info('Backup created: '.$disk->path($folder));

            return self::SUCCESS;
        } catch (Throwable $exception) {
            $disk->deleteDirectory($folder);
            report($exception);
            $this->error('Backup failed; incomplete output removed. Check the application log.');

            return self::FAILURE;
        }
    }
}
