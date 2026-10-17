<?php

namespace Tests\Support;

use RuntimeException;

class ConcurrentHiring
{
    public static function validatePath(string $path): void
    {
        $root = realpath(dirname(__DIR__, 2).'/storage/framework/testing');
        if ($root === false || realpath(dirname($path)) !== $root
            || ! preg_match('/^hiring-[a-f0-9]{16}\.sqlite$/D', basename($path)) || is_link($path)) {
            throw new RuntimeException('Concurrency database must be a generated file in storage/framework/testing.');
        }
    }

    public static function prepare(string $databasePath): array
    {
        self::validatePath($databasePath);
        if (file_exists($databasePath)) {
            throw new RuntimeException('Concurrency harness refuses an existing database.');
        }
        $file = fopen($databasePath, 'x');
        fclose($file);
        chmod($databasePath, 0600);

        return self::finish(self::start('prepare', $databasePath, []));
    }

    public static function race(string $databasePath, array $fixture): array
    {
        self::validatePath($databasePath);
        $workers = [];
        try {
            foreach (['first_quote_id', 'second_quote_id'] as $index => $key) {
                $workers[] = self::start('accept', $databasePath, [
                    'customer_id' => $fixture['customer_id'], 'quote_id' => $fixture[$key], 'slot' => $index,
                ]);
            }
            $deadline = microtime(true) + 5;
            while (! (is_file($databasePath.'.ready-0') && is_file($databasePath.'.ready-1'))) {
                if (microtime(true) > $deadline) {
                    throw new RuntimeException('Hiring workers failed to reach the barrier.');
                }
                usleep(10000);
            }
            file_put_contents($databasePath.'.go', 'go');

            return array_map(self::finish(...), $workers);
        } finally {
            foreach ($workers as $worker) {
                if (is_resource($worker['process'])) {
                    proc_terminate($worker['process']);
                    foreach ($worker['pipes'] as $pipe) {
                        if (is_resource($pipe)) {
                            fclose($pipe);
                        }
                    }
                    proc_close($worker['process']);
                }
            }
        }
    }

    public static function inspect(string $databasePath): array
    {
        return self::finish(self::start('inspect', $databasePath, []));
    }

    public static function cleanup(string $databasePath): void
    {
        self::validatePath($databasePath);
        foreach (['', '-journal', '-wal', '-shm', '.ready-0', '.ready-1', '.go'] as $suffix) {
            $path = $databasePath.$suffix;
            if (is_link($path)) {
                throw new RuntimeException('Refusing to remove a symlink in the test directory.');
            }
            if (is_file($path)) {
                unlink($path);
            }
        }
    }

    private static function start(string $mode, string $databasePath, array $payload): array
    {
        self::validatePath($databasePath);
        if (getenv('HAVEN_CONCURRENCY_APPROVED') !== '1') {
            throw new RuntimeException('Isolated file database testing has not been approved.');
        }
        $environment = array_merge(getenv(), [
            'APP_ENV' => 'testing', 'MODE' => 'testing', 'APP_DEBUG' => 'false',
            'APP_KEY' => 'base64:'.base64_encode(str_repeat('t', 32)),
            'DB_CONNECTION' => 'sqlite', 'DB_DATABASE' => $databasePath, 'DB_URL' => '',
            'SESSION_DRIVER' => 'array', 'CACHE_STORE' => 'array', 'QUEUE_CONNECTION' => 'sync',
            'MAIL_MAILER' => 'array', 'BROADCAST_CONNECTION' => 'log', 'DEMO_ENABLED' => 'false',
            'BOOST_ENABLED' => 'false', 'BCRYPT_ROUNDS' => '4',
        ]);
        $process = proc_open([PHP_BINARY, __DIR__.'/hiring-worker.php', $mode, $databasePath, json_encode($payload, JSON_THROW_ON_ERROR)],
            [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, dirname(__DIR__, 2), $environment);
        if (! is_resource($process)) {
            throw new RuntimeException('Unable to launch the isolated hiring worker.');
        }
        fclose($pipes[0]);
        unset($pipes[0]);
        foreach ($pipes as $pipe) {
            stream_set_blocking($pipe, false);
        }

        return ['process' => $process, 'pipes' => $pipes];
    }

    private static function finish(array $worker): array
    {
        $output = '';
        $errors = '';
        $deadline = microtime(true) + 15;
        try {
            do {
                $output .= stream_get_contents($worker['pipes'][1]);
                $errors .= stream_get_contents($worker['pipes'][2]);
                $status = proc_get_status($worker['process']);
                if (! $status['running']) {
                    break;
                }
                if (microtime(true) > $deadline) {
                    throw new RuntimeException('Isolated hiring worker timed out.');
                }
                usleep(10000);
            } while (true);
            $output .= stream_get_contents($worker['pipes'][1]);
            $errors .= stream_get_contents($worker['pipes'][2]);
            if ($status['exitcode'] !== 0) {
                throw new RuntimeException('Hiring worker failed: '.$errors.' '.$output);
            }

            return json_decode($output, true, flags: JSON_THROW_ON_ERROR);
        } finally {
            if (is_resource($worker['process'])) {
                proc_terminate($worker['process']);
            }
            foreach ($worker['pipes'] as $pipe) {
                fclose($pipe);
            }
            proc_close($worker['process']);
        }
    }
}
