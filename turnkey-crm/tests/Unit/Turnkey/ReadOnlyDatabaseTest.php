<?php

use Illuminate\Config\Repository;
use Illuminate\Database\Connection;
use Illuminate\Database\Connectors\ConnectionFactory;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Events\Dispatcher;
use Illuminate\Foundation\Application;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Webkul\Turnkey\Providers\ReadOnlyDatabaseServiceProvider;
use Webkul\Turnkey\Support\ReadOnlyDatabase;

function disconnectedDemoConnection(): Connection
{
    return new Connection(fn () => throw new LogicException('A test must never open a database connection.'));
}

it('rejects mutating or ambiguous SQL before PDO is resolved', function (string $sql) {
    $connection = disconnectedDemoConnection();
    (new ReadOnlyDatabase)->protect($connection);

    expect(fn () => $connection->unprepared($sql))
        ->toThrow(AccessDeniedHttpException::class, 'This demo is read-only.');
})->with([
    'insert' => 'insert into persons (name) values (?)',
    'update' => 'UPDATE persons SET name = ?',
    'delete' => 'delete from persons',
    'replace' => 'replace into persons (id) values (1)',
    'truncate' => 'truncate table persons',
    'create' => 'create table test (id int)',
    'alter' => 'alter table persons add column test int',
    'drop' => 'drop table persons',
    'rename' => 'rename table persons to old_persons',
    'grant' => 'grant all on demo.* to demo_user',
    'call' => 'call delete_all_people()',
    'execute' => 'execute prepared_write',
    'set' => 'set session sql_mode = ""',
    'pragma' => 'pragma user_version = 2',
    'comment prefix' => '/* dashboard */ DELETE FROM persons',
    'line comment' => "-- dashboard\nDELETE FROM persons",
    'executable comment' => '/*!50000 DELETE FROM persons */',
    'mariadb executable comment' => '/*M!100000 DELETE FROM persons */',
    'select into file' => "select * from persons into outfile '/tmp/export'",
    'select into table' => 'select * into persons_copy from persons',
    'embedded executable comment' => "select * from persons /*! INTO OUTFILE '/tmp/export' */",
    'stacked statements' => 'select * from persons; delete from persons',
    'stacked after comment' => "select 1; -- report\n drop table persons",
    'write CTE' => 'with removed as (delete from persons returning *) select * from removed',
    'read CTE fails closed' => 'with people as (select * from persons) select * from people',
    'explain analyze write' => 'explain analyze delete from persons',
    'locking select' => 'select * from persons for update',
    'sequence write' => "select setval('person_id_seq', 100)",
    'sequence increment' => "select nextval('person_id_seq')",
    'postgres hash is an operator' => 'SELECT 1 # 1; DELETE FROM persons',
    'quoted sequence function' => 'SELECT pg_catalog."nextval"(\'person_id_seq\')',
    'quoted function with comments' => 'SELECT pg_catalog."nextval" /* sequence */ (\'person_id_seq\')',
    'quoted function fails closed' => 'SELECT `custom_function`()',
    'sequence syntax' => 'SELECT NEXT VALUE FOR person_id_seq',
    'sequence syntax with comments' => 'SELECT NEXT /* sequence */ VALUE FOR person_id_seq',
    'unsupported dollar quotes' => 'SELECT $$ /* $$; DELETE FROM persons; -- */',
    'unsupported bracket quotes' => 'SELECT [/*]; DELETE FROM persons; -- */',
    'nested block comments' => "SELECT 1 /* outer /* inner */ ' */; DELETE FROM persons; -- '",
    'extension loading' => "select load_extension('extension')",
    'backslash quoting is ambiguous' => "select 'can\\'t'",
    'empty' => '',
    'unterminated string' => "select 'unterminated",
    'unterminated comment' => 'select 1 /* unterminated',
]);

it('allows normal CRM reads without connecting to a database', function (string $sql) {
    $connection = disconnectedDemoConnection();
    (new ReadOnlyDatabase)->protect($connection);

    $log = $connection->pretend(fn ($connection) => $connection->select($sql, [123]));

    expect($log)->toHaveCount(1)
        ->and($log[0]['query'])->toBe(str_replace('?', '123', $sql))
        ->and($log[0]['bindings'])->toBe([123]);
})->with([
    'select' => 'select * from `persons` where `name` = ?',
    'aggregate' => 'select count(*) as aggregate from `leads` where exists (select * from persons where persons.id = leads.person_id)',
    'dashboard' => "select DATE_FORMAT(created_at, '%Y-%m') as period, SUM(lead_value) from leads group by period",
    'show' => 'SHOW FULL TABLES',
    'describe' => 'describe persons',
    'desc' => 'DESC persons',
    'comments' => "/* report */ SELECT 1 -- comment\n;",
    'quoted text' => "select 'delete; /* not a comment */' as `update`, 'it''s safe' as label",
    'quoted identifier' => 'select "drop" from "select"',
]);

it('blocks query builder writes, raw statements and writes disguised as selects', function () {
    $connection = disconnectedDemoConnection();
    (new ReadOnlyDatabase)->protect($connection);

    foreach ([
        fn () => $connection->table('persons')->insert(['name' => 'Example']),
        fn () => $connection->table('persons')->where('id', 1)->update(['name' => 'Example']),
        fn () => $connection->table('persons')->where('id', 1)->delete(),
        fn () => $connection->table('persons')->increment('id'),
        fn () => $connection->statement('drop table persons'),
        fn () => $connection->select('delete from persons returning *'),
        fn () => iterator_to_array($connection->cursor('delete from persons returning *')),
    ] as $write) {
        expect($write)->toThrow(AccessDeniedHttpException::class);
    }
});

it('guards existing, named, reconnected and newly created connections once in a demo environment', function () {
    $app = new Application(dirname(__DIR__, 3));
    $app->instance('config', new Repository([
        'app' => ['env' => 'demo'],
        'database' => ['default' => 'primary', 'connections' => ['primary' => ['driver' => 'mysql'], 'secondary' => ['driver' => 'mysql']]],
    ]));
    $app->instance('events', new Dispatcher($app));
    $factory = Mockery::mock(ConnectionFactory::class);
    $factory->shouldReceive('make')->andReturnUsing(fn () => disconnectedDemoConnection());
    $app->singleton('db', fn () => new DatabaseManager($app, $factory));
    $existing = $app['db']->connection();

    try {
        (new ReadOnlyDatabaseServiceProvider($app))->register();
        $named = $app['db']->connection('secondary');
        $app['db']->reconnect('secondary');
        $app['db']->purge('primary');
        $replacement = $app['db']->connection();

        foreach ([$existing, $named, $replacement] as $connection) {
            expect(fn () => $connection->delete('delete from persons'))->toThrow(AccessDeniedHttpException::class);
            $callbacks = new ReflectionProperty(Connection::class, 'beforeExecutingCallbacks');
            expect($callbacks->getValue($connection))->toHaveCount(1);
        }
    } finally {
        Application::setInstance(null);
    }
});

it('does not eagerly resolve database services and leaves other environments writable', function (string $environment) {
    $app = new Application(dirname(__DIR__, 3));
    $app->instance('config', new Repository(['app' => ['env' => $environment]]));
    $app->instance('events', new Dispatcher($app));
    $app->singleton('db', fn () => throw new LogicException('Provider must not create database connections.'));

    try {
        (new ReadOnlyDatabaseServiceProvider($app))->register();
        expect($app->resolved('db'))->toBeFalse();
        $connection = disconnectedDemoConnection();
        $app['events']->dispatch(new ConnectionEstablished($connection));

        if ($environment === 'demo') {
            expect(fn () => $connection->update('update persons set name = ?', ['Example']))->toThrow(AccessDeniedHttpException::class);
        } else {
            $log = $connection->pretend(fn ($connection) => $connection->update('update persons set id = ?', [123]));
            expect($log)->toHaveCount(1);
        }
    } finally {
        Application::setInstance(null);
    }
})->with(['demo', 'local', 'testing', 'production']);
