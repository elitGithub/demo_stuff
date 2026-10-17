<?php

namespace Tests\Support;

use Illuminate\Database\MySqlConnection;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

class InfinityFreeExport
{
    public static function sql(): string
    {
        if (! app()->environment('testing') || DB::connection()->getDatabaseName() !== ':memory:'
            || config('database.default') !== 'sqlite') {
            throw new RuntimeException('Deployment fixture export only supports isolated in-memory tests.');
        }

        $tables = ['users', 'categories', 'provider_profiles', 'category_provider_profile', 'service_requests',
            'quotes', 'request_photos', 'messages', 'job_events', 'reviews', 'payments', 'notifications'];
        $rows = [];
        foreach ($tables as $table) {
            $rows[$table] = DB::table($table)->get()->map(fn ($row) => (array) $row)->all();
        }
        $migrations = glob(database_path('migrations/*.php'));
        sort($migrations);

        // Compile the actual migrations with Laravel's MySQL grammar. The PDO
        // resolver throws if any compiler ever attempts a real connection.
        $mysql = new class(fn () => throw new RuntimeException('Export cannot connect to MySQL.'), 'haven', '', ['charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci', 'engine' => 'InnoDB']) extends MySqlConnection
        {
            public function isMaria(): bool
            {
                return false;
            }

            public function getServerVersion(): string
            {
                return '8.0.0';
            }
        };
        $previousSchema = Schema::getFacadeRoot();
        try {
            Schema::swap($mysql->getSchemaBuilder());
            $statements = $mysql->pretend(function () use ($migrations): void {
                Schema::create('migrations', function (Blueprint $table): void {
                    $table->id();
                    $table->string('migration');
                    $table->integer('batch');
                });
                foreach ($migrations as $file) {
                    (require $file)->up();
                }
            });
        } finally {
            Schema::swap($previousSchema);
        }

        $sql = "-- Haven fictional demo. Import only into a NEW EMPTY dedicated database.\n"
            ."-- No DROP/TRUNCATE/reset. Do not blindly retry a partially completed DDL import.\n"
            ."SET NAMES utf8mb4;\n\n";
        foreach ($statements as $statement) {
            if ($statement['bindings'] !== []) {
                throw new RuntimeException('Unexpected schema bindings; review the export compiler.');
            }
            $sql .= $statement['query'].";\n";
        }
        $sql .= "\nSTART TRANSACTION;\n";
        $agreements = [];
        foreach ($rows as $table => $records) {
            foreach ($records as $record) {
                if ($table === 'service_requests' && $record['accepted_quote_id'] !== null) {
                    $agreements[$record['id']] = $record['accepted_quote_id'];
                    $record['accepted_quote_id'] = null;
                }
                $sql .= self::insert($table, $record);
            }
        }
        $tick = chr(96);
        foreach ($agreements as $job => $quote) {
            $sql .= "UPDATE {$tick}service_requests{$tick} SET {$tick}accepted_quote_id{$tick} = ".(int) $quote." WHERE {$tick}id{$tick} = ".(int) $job.";\n";
        }
        foreach ($migrations as $index => $file) {
            $sql .= self::insert('migrations', ['id' => $index + 1, 'migration' => basename($file, '.php'), 'batch' => 1]);
        }

        return $sql."COMMIT;\n";
    }

    private static function insert(string $table, array $row): string
    {
        $quote = fn (string $identifier): string => chr(96).$identifier.chr(96);
        $columns = implode(', ', array_map($quote, array_keys($row)));
        $values = implode(', ', array_map(function ($value): string {
            if ($value === null) {
                return 'NULL';
            }
            if (is_int($value) || is_float($value)) {
                return (string) $value;
            }
            if ($value === '') {
                return "''";
            }

            // Hex text avoids dependence on MySQL backslash/string SQL modes.
            return 'CONVERT(0x'.bin2hex((string) $value).' USING utf8mb4)';
        }, array_values($row)));

        return 'INSERT INTO '.$quote($table).' ('.$columns.') VALUES ('.$values.");\n";
    }
}
