<?php

namespace App\Providers;

use App\Support\ReadOnlyDatabase;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Support\ServiceProvider;

class ReadOnlyDatabaseServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $guard = new ReadOnlyDatabase(fn (): bool => (bool) $this->app['config']->get('demo.read_only'));
        $this->app['events']->listen(ConnectionEstablished::class,
            fn (ConnectionEstablished $event) => $guard->protect($event->connection));

        $this->callAfterResolving('db', function (DatabaseManager $database) use ($guard): void {
            foreach ($database->getConnections() as $connection) {
                $guard->protect($connection);
            }
        });
    }
}
