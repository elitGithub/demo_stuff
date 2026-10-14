<?php

namespace Webkul\Turnkey\Providers;

use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Support\ServiceProvider;
use Webkul\Turnkey\Support\ReadOnlyDatabase;

class ReadOnlyDatabaseServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../Config/turnkey.php', 'turnkey');

        $readOnly = in_array($this->app['config']->get('app.env'), $this->app['config']->get('turnkey.read_only_environments', ['demo']), true);
        $this->app['config']->set('turnkey.read_only', $readOnly);

        if (! $readOnly) {
            return;
        }

        $guard = new ReadOnlyDatabase;

        // Register before other application providers boot. This covers default,
        // named, dynamically created and reconnected Laravel connections, including CLI.
        $this->app['events']->listen(ConnectionEstablished::class, fn (ConnectionEstablished $event) => $guard->protect($event->connection));

        // Cover connections resolved earlier without creating or opening any here.
        $this->callAfterResolving('db', function (DatabaseManager $database) use ($guard): void {
            foreach ($database->getConnections() as $connection) {
                $guard->protect($connection);
            }
        });
    }
}
