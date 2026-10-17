<?php

namespace Tests\Unit;

use App\Support\ReadOnlyDatabase;
use Illuminate\Database\Connection;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class ReadOnlyDatabaseTest extends TestCase
{
    #[DataProvider('reads')]
    public function test_safe_reads_are_allowed_without_a_pdo_connection(string $sql): void
    {
        $connection = new Connection(fn () => throw new \RuntimeException('PDO must not be opened.'));
        (new ReadOnlyDatabase(fn () => true))->protect($connection);
        self::assertCount(1, $connection->pretend(fn () => $connection->select($sql)));
    }

    #[DataProvider('unsafe')]
    public function test_mutating_or_ambiguous_sql_is_blocked_before_pdo(string $sql): void
    {
        $connection = new Connection(fn () => throw new \RuntimeException('PDO must not be opened.'));
        (new ReadOnlyDatabase(fn () => true))->protect($connection);
        $this->expectException(AccessDeniedHttpException::class);
        $connection->pretend(fn () => $connection->select($sql));
    }

    public static function reads(): array
    {
        return [
            ['SELECT * FROM users WHERE name = ?'], ["select 'delete from users' as label"],
            ['/* ordinary comment */ SELECT count(*) FROM "users";'],
            ['select "users".* from "users" where "id" = ?'],
            ['select json_extract(service_areas, \'$[0]\') from provider_profiles'],
            ['SHOW TABLES'], ['DESCRIBE users'],
        ];
    }

    public static function unsafe(): array
    {
        return [
            ['SELECT 1; DELETE FROM users'], ['WITH x AS (SELECT 1) SELECT * FROM x'],
            ['SELECT * INTO OUTFILE \'/tmp/x\' FROM users'], ['SELECT * FROM users FOR UPDATE'],
            ['SELECT GET_LOCK(\'x\', 1)'], ['SELECT "get_lock"(\'x\', 1)'],
            ['SELECT nextval(\'sequence\')'], ['SELECT NEXT VALUE FOR sequence'],
            ['SELECT load_extension(\'x\')'], ['SELECT @x := 1'],
            ['/*!50000 DELETE FROM users */ SELECT 1'], ['/*M! DELETE FROM users */ SELECT 1'],
            ['/* outer /* nested */ SELECT 1'], ['SELECT 1 #comment'],
            ['PRAGMA journal_mode = WAL'], ['EXPLAIN DELETE FROM users'],
            ['SELECT \'unterminated'], ["SELECT 'back\\slash'"],
        ];
    }
}
