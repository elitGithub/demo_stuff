<?php

namespace App\Console\Commands;

use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use RuntimeException;
use Throwable;

#[Signature('casefile:build-template {--path= : Where to write the template database (default: the configured sandbox template)} {--force : Replace an existing file at the path}')]
#[Description('Build the shipped template database: a fresh SQLite file, migrated and seeded with the demo content')]
class BuildTemplateCommand extends Command
{
    private const string CONNECTION = 'template';

    /**
     * @return int
     *
     * @throws RuntimeException
     * @throws Throwable
     */
    public function handle(): int
    {
        $path = $this->option('path') ?? config('casefile.sandbox.template');

        if (! is_string($path) || trim($path) === '') {
            $this->components->error('The --path option needs a file path.');

            return self::FAILURE;
        }

        if (File::exists($path) && ! $this->option('force')) {
            $this->components->error('A file already exists at '.$path.'. Pass --force to replace it.');

            return self::FAILURE;
        }

        $building = $path.'.building';

        try {
            File::ensureDirectoryExists(dirname($path));
            File::put($building, '');

            $base = config('database.connections.sqlite');

            if (! is_array($base)) {
                throw new RuntimeException('The sqlite connection is not configured; the template connection copies it.');
            }

            config(['database.connections.'.self::CONNECTION => array_merge($base, ['database' => $building, 'url' => null])]);
            DB::purge(self::CONNECTION);

            foreach (['migrate', 'db:seed'] as $step) {
                $exitCode = Artisan::call($step, ['--database' => self::CONNECTION, '--force' => true, '--no-interaction' => true]);

                if ($exitCode !== self::SUCCESS) {
                    throw new RuntimeException(sprintf('%s failed with exit code %d: %s', $step, $exitCode, trim(Artisan::output())));
                }
            }

            $connection = DB::connection(self::CONNECTION);
            $expectedCases = count(require database_path('seeders/data/cases.php'));
            $cases = $connection->table('cases')->count();

            if ($cases !== $expectedCases) {
                throw new RuntimeException(sprintf('The template holds %d cases; the seed data defines %d.', $cases, $expectedCases));
            }

            $summary = sprintf(
                'Template written to %s: %d cases, %d mailbox messages, %d script entries, schema %s.',
                $path,
                $cases,
                $connection->table('mailbox_messages')->count(),
                $connection->table('script_entries')->count(),
                $connection->table('installation_meta')->value('schema_version'),
            );

            DB::purge(self::CONNECTION);
            File::move($building, $path);
        } catch (Throwable $exception) {
            DB::purge(self::CONNECTION);
            File::delete($building);

            throw $exception;
        }

        $this->components->info($summary);

        return self::SUCCESS;
    }
}
