<?php

use Illuminate\Database\Events\ConnectionEstablished;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Support\Env;
use Illuminate\Support\Facades\Vite;

require_once dirname(__DIR__, 2).'/vendor/autoload.php';

$project = dirname(__DIR__, 2);
$runtime = $project.'/storage/framework/testing/css-audit-20261018';
$private = $runtime.'/private';
$database = $private.'/casefile.sqlite';
$buildName = getenv('CASEFILE_AUDIT_BUILD') ?: 'baseline';

if (! preg_match('/\A(?:baseline|final-[0-9]{2})\z/', $buildName)) {
    throw new RuntimeException('Invalid audit build name.');
}

foreach ([$runtime, $private, $private.'/environment', $runtime.'/public', $private.'/application.key'] as $path) {
    if (realpath($path) !== $path || is_link($path)) {
        throw new RuntimeException('Audit paths must exist without symlinks: '.$path);
    }
}

foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($private, FilesystemIterator::SKIP_DOTS)) as $entry) {
    if ($entry->isLink()) {
        throw new RuntimeException('Audit private paths must not contain symlinks.');
    }
}

if (count(scandir($private.'/environment')) !== 2 || file_exists($private.'/never-use-hot')) {
    throw new RuntimeException('Audit environment must be empty and the hot file must not exist.');
}

$values = [
    'APP_ENV' => 'testing',
    'APP_DEBUG' => 'false',
    'APP_KEY' => trim(file_get_contents($private.'/application.key')),
    'APP_URL' => 'http://127.0.0.1:8094',
    'ASSET_URL' => '',
    'CASEFILE_MODE' => 'local',
    'DB_CONNECTION' => 'sqlite',
    'DB_DATABASE' => $database,
    'DB_URL' => '',
    'SESSION_DRIVER' => 'file',
    'SESSION_DOMAIN' => '',
    'SESSION_SECURE_COOKIE' => 'false',
    'SESSION_PATH' => '/',
    'CACHE_STORE' => 'file',
    'QUEUE_CONNECTION' => 'sync',
    'MAIL_MAILER' => 'array',
    'APP_MAINTENANCE_DRIVER' => 'file',
    'LOG_CHANNEL' => 'single',
    'LOG_DEPRECATIONS_CHANNEL' => 'null',
    'FILESYSTEM_DISK' => 'local',
];

foreach (['CONFIG', 'SERVICES', 'PACKAGES', 'ROUTES', 'EVENTS'] as $cache) {
    $values['APP_'.$cache.'_CACHE'] = $private.'/cache/'.strtolower($cache).'.php';
}

foreach ($values as $name => $value) {
    putenv($name);
    unset($_ENV[$name], $_SERVER[$name]);
    if (! Env::getRepository()->set($name, $value) || Env::getRepository()->get($name) !== $value) {
        throw new RuntimeException('Cannot establish isolated audit environment: '.$name);
    }
}

$app = require $project.'/bootstrap/app.php';
$app->useEnvironmentPath($private.'/environment');
$app->useStoragePath($private);
$app->usePublicPath($runtime.'/public');
$app->afterBootstrapping(LoadConfiguration::class, function ($application) use ($database, $private, $runtime, $buildName): void {
    $config = $application['config'];

    if ($config->get('database.default') !== 'sqlite'
        || $config->get('database.connections.sqlite.database') !== $database
        || ! in_array($config->get('database.connections.sqlite.url'), [null, ''], true)
        || $application->storagePath() !== $private
        || $application->publicPath() !== $runtime.'/public'
        || $application->environmentPath() !== $private.'/environment') {
        throw new RuntimeException('Resolved application paths escape the audit runtime.');
    }

    $config->set('database.connections', ['sqlite' => $config->get('database.connections.sqlite')]);
    $config->set('session.cookie', 'casefile_css_audit_session');
    $config->set('session.domain', null);
    $config->set('session.secure', false);
    $config->set('view.compiled', $private.'/framework/views');
    $application['events']->listen(ConnectionEstablished::class, function (ConnectionEstablished $event) use ($database): void {
        $connection = $event->connection;
        $expected = $connection->getName() === 'template' ? $database.'.building' : $database;

        if (! in_array($connection->getName(), ['sqlite', 'template'], true)
            || $connection->getDriverName() !== 'sqlite'
            || $connection->getDatabaseName() !== $expected
            || ! in_array($connection->getConfig('url'), [null, ''], true)
            || is_link($expected)) {
            throw new RuntimeException('Database connection escapes the audit runtime.');
        }
    });
    $application->booted(function () use ($private, $buildName): void {
        Vite::useHotFile($private.'/never-use-hot')->useBuildDirectory('build/'.$buildName);
    });
});

return $app;
