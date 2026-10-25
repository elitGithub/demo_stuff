<?php

namespace App\Services;

use FilesystemIterator;
use PDO;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use Symfony\Component\Process\Process;
use ZipArchive;

class DeploymentService
{
    /**
     * @param string $outputDirectory
     * @param string $fixtureDirectory
     * @return string
     * @throws RuntimeException
     */
    public function package(string $outputDirectory, string $fixtureDirectory): string
    {
        $output = $this->resolvedPath($outputDirectory);
        $fixtures = $this->resolvedPath($fixtureDirectory);
        $allowed = app()->environment('testing') ? base_path('storage/framework/testing').'/' : dirname(base_path()).'/deploy/';
        if (! str_starts_with($output.'/', $allowed) || ! str_starts_with($fixtures.'/', $allowed) || file_exists($output) || ! is_dir($fixtures)) {
            throw new RuntimeException('Package output must be new and fixtures must be inside the approved build root.');
        }
        if (! in_array('argon2id', password_algos(), true) || ! extension_loaded('pdo_sqlite') || ! extension_loaded('gd') || ! extension_loaded('zip')) {
            throw new RuntimeException('Packaging requires PHP Argon2id, PDO SQLite, GD and Zip.');
        }
        foreach (['registry.sqlite', 'template.sqlite'] as $filename) {
            $path = $fixtures.'/'.$filename;
            if (! is_file($path) || is_link($path)) {
                throw new RuntimeException('Pristine fixture files are required.');
            }
            $database = new PDO('sqlite:'.$path, options: [PDO::SQLITE_ATTR_OPEN_FLAGS => PDO::SQLITE_OPEN_READONLY]);
            $tables = $filename === 'registry.sqlite' ? ['sandboxes', 'sessions', 'revoked_sessions', 'cache', 'cache_locks', 'sandbox_files'] : [];
            foreach ($tables as $table) {
                if ((int) $database->query('SELECT COUNT(*) FROM '.$table)->fetchColumn() !== 0) {
                    throw new RuntimeException('Registry fixtures must contain no visitor state.');
                }
            }
            if ($filename === 'template.sqlite') {
                if ($database->query('SELECT seed_anchor FROM sandbox_meta')->fetchColumn() !== null || (int) $database->query('SELECT COUNT(*) FROM users')->fetchColumn() !== 16 || (int) $database->query('SELECT COUNT(*) FROM bookings WHERE seed_key IS NULL')->fetchColumn() !== 0 || (int) $database->query('SELECT COUNT(*) FROM portfolio_images WHERE seed_asset IS NULL')->fetchColumn() !== 0) {
                    throw new RuntimeException('Template fixtures must be pristine.');
                }
                foreach ($database->query('SELECT password FROM users') as $record) {
                    if (password_get_info($record['password'])['algoName'] !== 'argon2id') {
                        throw new RuntimeException('Fixture accounts require Argon2id hashes.');
                    }
                }
            }
            $database = null;
        }
        $root = $output.'/stylist-discovery';
        foreach (['_app/bootstrap/cache', '_app/storage/app/demo-runtime', '_app/storage/framework/views', '_app/storage/framework/cache/data', '_app/storage/framework/sessions', '_app/storage/logs'] as $directory) {
            if (! mkdir($root.'/'.$directory, 0750, true)) {
                throw new RuntimeException('Cannot create package storage.');
            }
        }
        foreach (['app', 'config', 'resources/views', 'routes', 'database/migrations', 'database/seeders'] as $directory) {
            $this->copyTree(base_path($directory), $root.'/_app/'.$directory);
        }
        foreach (['composer.json', 'composer.lock', 'bootstrap/app.php', 'bootstrap/providers.php'] as $file) {
            $this->copyFile(base_path($file), $root.'/_app/'.$file);
        }
        $this->copyTree(public_path('assets'), $root.'/assets');
        $this->copyTree(dirname(base_path()).'/deploy/infinityfree', $root);
        $this->copyFile($fixtures.'/registry.sqlite', $root.'/_app/storage/app/demo-runtime/registry.sqlite');
        $this->copyFile($fixtures.'/template.sqlite', $root.'/_app/storage/app/demo-runtime/template.sqlite');
        $process = new Process(['/usr/bin/php8.4', '/usr/local/bin/composer', 'install', '--no-dev', '--no-scripts', '--no-interaction', '--prefer-dist', '--classmap-authoritative'], $root.'/_app', ['APP_ENV' => 'production', 'COMPOSER_VENDOR_DIR' => false]);
        $process->setTimeout(300);
        $process->mustRun();
        $archive = $output.'/strand-city-infinityfree.zip';
        $zip = new ZipArchive;
        if ($zip->open($archive, ZipArchive::CREATE | ZipArchive::EXCL) !== true) {
            throw new RuntimeException('Cannot create package archive.');
        }
        $count = 0;
        $bytes = 0;
        $entries = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
        foreach ($entries as $entry) {
            if ($entry->isLink()) {
                throw new RuntimeException('Package files must not be symbolic links.');
            }
            $relative = 'stylist-discovery/'.substr($entry->getPathname(), strlen($root) + 1);
            if ($entry->isDir()) {
                $zip->addEmptyDir($relative);
            } else {
                $count++;
                $bytes += $entry->getSize();
                if ($count >= 30000 - 255 || ! $zip->addFile($entry->getPathname(), $relative)) {
                    throw new RuntimeException('Package exceeds the reserved file budget or cannot be archived.');
                }
            }
        }
        if (! $zip->close()) {
            throw new RuntimeException('Cannot finish package archive.');
        }
        if (file_put_contents($output.'/manifest.json', json_encode(['files' => $count, 'source_bytes' => $bytes, 'archive_bytes' => filesize($archive), 'runtime_reserve_bytes' => 440 * 1024 * 1024, 'runtime_file_reserve' => 255, 'sha256' => hash_file('sha256', $archive)], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR)."\n", LOCK_EX) === false) {
            throw new RuntimeException('Cannot write package manifest.');
        }

        return $archive;
    }

    /** @param string $path @return string */
    public function resolvedPath(string $path): string
    {
        $segments = [];
        foreach (explode('/', str_starts_with($path, '/') ? $path : base_path($path)) as $segment) {
            if ($segment === '..') {
                array_pop($segments);
            } elseif ($segment !== '' && $segment !== '.') {
                $segments[] = $segment;
            }
            if (is_link('/'.implode('/', $segments))) {
                throw new RuntimeException('Build paths cannot contain symbolic links.');
            }
        }

        return '/'.implode('/', $segments);
    }

    /** @param string $source @param string $destination @return void */
    public function copyTree(string $source, string $destination): void
    {
        $entries = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST);
        foreach ($entries as $entry) {
            if ($entry->isLink()) {
                throw new RuntimeException('Build sources cannot contain symbolic links.');
            }
            if ($entry->isFile()) {
                $this->copyFile($entry->getPathname(), $destination.'/'.substr($entry->getPathname(), strlen($source) + 1));
            }
        }
    }

    /** @param string $source @param string $destination @return void */
    public function copyFile(string $source, string $destination): void
    {
        if (is_link($source) || ! is_file($source) || file_exists($destination)) {
            throw new RuntimeException('Package copies require ordinary sources and new destinations.');
        }
        if (! is_dir(dirname($destination)) && ! mkdir(dirname($destination), 0750, true)) {
            throw new RuntimeException('Cannot create package directory.');
        }
        if (! copy($source, $destination)) {
            throw new RuntimeException('Cannot copy package source.');
        }
    }
}
