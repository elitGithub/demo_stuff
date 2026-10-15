<?php

use Illuminate\Database\MySqlConnection;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Application;

it('creates hosted tables with InnoDB while retaining full Unicode column lengths', function (bool $hosted, string $driver) {
    $app = new Application(dirname(__DIR__, 3));
    $previousEnv = $_ENV['TURNKEY_SHARED_HOSTING'] ?? null;
    $previousServer = $_SERVER['TURNKEY_SHARED_HOSTING'] ?? null;
    $_ENV['TURNKEY_SHARED_HOSTING'] = $_SERVER['TURNKEY_SHARED_HOSTING'] = $hosted ? 'true' : 'false';

    try {
        $config = require $app->configPath('database.php');
        $connection = new MySqlConnection(
            fn () => throw new LogicException('SQL compilation must never open a database connection.'),
            'not_connected',
            '',
            $config['connections'][$driver],
        );
        $connection->useDefaultSchemaGrammar();

        // Compile the failing index shape without running a migration or executing SQL.
        $tokens = new Blueprint($connection, 'personal_access_tokens');
        $tokens->create();
        $tokens->id();
        $tokens->morphs('tokenable');
        $sql = $tokens->toSql();

        expect($sql[0])->toContain('`tokenable_type` varchar(255)', 'utf8mb4');
        expect($sql[1])->toContain('personal_access_tokens_tokenable_type_tokenable_id_index');
        if ($hosted) {
            expect($sql[0])->toContain('engine = InnoDB');
        } else {
            expect($sql[0])->not->toContain('engine =');
        }

        // Krayin also indexes pairs of strings; shortening strings to 191 would
        // still exceed MyISAM's 1,000-byte limit for this index.
        $attributes = new Blueprint($connection, 'attributes');
        $attributes->create();
        $attributes->string('code');
        $attributes->string('entity_type');
        $attributes->unique(['code', 'entity_type']);
        $attributeSql = $attributes->toSql();
        expect($attributeSql[0])->toContain('`code` varchar(255)', '`entity_type` varchar(255)');
        if ($hosted) {
            expect($attributeSql[0])->toContain('engine = InnoDB');
        }
        expect($connection->getRawPdo())->toBeInstanceOf(Closure::class);
    } finally {
        if ($previousEnv === null) {
            unset($_ENV['TURNKEY_SHARED_HOSTING']);
        } else {
            $_ENV['TURNKEY_SHARED_HOSTING'] = $previousEnv;
        }
        if ($previousServer === null) {
            unset($_SERVER['TURNKEY_SHARED_HOSTING']);
        } else {
            $_SERVER['TURNKEY_SHARED_HOSTING'] = $previousServer;
        }
        Application::setInstance(null);
    }
})->with([true, false])->with(['mysql', 'mariadb']);
