<?php

namespace App\Sandbox;

use App\Data\SandboxHandle;
use App\Exceptions\SandboxLimitReached;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Contracts\Session\Session;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\RateLimiter;
use InvalidArgumentException;
use Pdo\Sqlite;
use PDOException;
use RuntimeException;
use Throwable;

final class SandboxStore
{
    public const string RESET_NOTICE = 'Your demo was reset.';

    private const string ID_PATTERN = '/\A[0-9a-f]{32}\z/';

    private const string LOCK = 'casefile-sandbox-provision';

    private const int LOCK_SECONDS = 10;

    private const int LOCK_WAIT_SECONDS = 5;

    private const string STARTED_THIS_REQUEST = 'casefile_sandbox_started_this_request';

    private ?string $templateVersion = null;

    /**
     * @param  SeedCalendar  $calendar
     */
    public function __construct(private readonly SeedCalendar $calendar) {}

    /**
     * @param  Session  $session
     * @param  string  $clientKey
     * @return SandboxHandle
     *
     * @throws SandboxLimitReached
     * @throws LockTimeoutException
     * @throws RuntimeException
     * @throws Throwable
     */
    public function start(Session $session, string $clientKey): SandboxHandle
    {
        $key = config('casefile.sandbox.session_key');
        $current = $session->get($key);

        if (is_string($current) && $session->get(self::STARTED_THIS_REQUEST) === $current) {
            return new SandboxHandle(id: $current, path: $this->pathFor($current));
        }

        $handle = $this->provision($clientKey, is_string($current) ? $current : null);

        $this->attach($handle);
        $session->put($key, $handle->id);
        $session->now(self::STARTED_THIS_REQUEST, $handle->id);

        return $handle;
    }

    /**
     * @param  Session  $session
     * @return void
     *
     * @throws InvalidArgumentException
     * @throws RuntimeException
     */
    public function finish(Session $session): void
    {
        $id = $session->get(config('casefile.sandbox.session_key'));

        if (is_string($id) && $session->get(self::STARTED_THIS_REQUEST) === $id) {
            $this->discard($id);
        }
    }

    /**
     * @param  string  $clientKey
     * @param  ?string  $replacing
     * @return SandboxHandle
     *
     * @throws SandboxLimitReached
     * @throws LockTimeoutException
     * @throws RuntimeException
     * @throws Throwable
     */
    public function provision(string $clientKey, ?string $replacing = null): SandboxHandle
    {
        $template = $this->templatePath();
        $limit = RateLimiter::limiter('sandbox')($clientKey);

        return Cache::lock(self::LOCK, self::LOCK_SECONDS)->block(self::LOCK_WAIT_SECONDS, function () use ($template, $limit, $replacing): SandboxHandle {
            if (RateLimiter::tooManyAttempts($limit->key, $limit->maxAttempts)) {
                throw new SandboxLimitReached(
                    message: 'Too many demo sessions from this address; try again in an hour.',
                    retryAfterSeconds: $limit->decaySeconds,
                );
            }

            RateLimiter::hit($limit->key, $limit->decaySeconds);
            $path = null;

            try {
                if ($replacing !== null) {
                    $this->discard($replacing);
                }

                $this->sweep(reserve: 1);

                $id = bin2hex(random_bytes(16));
                $path = $this->pathFor($id);

                File::put($path, '');
                File::chmod($path, 0600);

                if (! File::copy($template, $path)) {
                    throw new RuntimeException('Could not copy the sandbox template to '.$path.'.');
                }

                $this->calendar->shift($path, CarbonImmutable::now());

                return new SandboxHandle(id: $id, path: $path);
            } catch (Throwable $exception) {
                RateLimiter::decrement($limit->key, $limit->decaySeconds);

                if ($path !== null) {
                    try {
                        $this->remove($path);
                    } catch (Throwable $cleanupException) {
                        throw new RuntimeException(message: $cleanupException->getMessage(), previous: $exception);
                    }
                }

                throw $exception;
            }
        });
    }

    /**
     * @param  string  $id
     * @return ?SandboxHandle
     *
     * @throws RuntimeException
     * @throws PDOException
     */
    public function resolve(string $id): ?SandboxHandle
    {
        if (preg_match(self::ID_PATTERN, $id) !== 1) {
            return null;
        }

        $path = $this->pathFor($id);
        clearstatcache(true, $path);

        if (! File::isFile($path) || File::lastModified($path) < $this->expiresBefore()) {
            return null;
        }

        $template = $this->templatePath();
        $this->templateVersion ??= $this->schemaVersion($template)
            ?? throw new RuntimeException('The sandbox template at '.$template.' records no schema_version.');

        if ($this->schemaVersion($path) !== $this->templateVersion) {
            return null;
        }

        return new SandboxHandle(id: $id, path: $path);
    }

    /**
     * @param  string  $id
     * @return void
     *
     * @throws InvalidArgumentException
     * @throws RuntimeException
     */
    public function discard(string $id): void
    {
        $this->remove($this->pathFor($id));
    }

    /**
     * @param  int  $reserve
     * @return int
     *
     * @throws RuntimeException
     */
    public function sweep(int $reserve = 0): int
    {
        $directory = config('casefile.sandbox.directory');
        File::ensureDirectoryExists($directory, 0700);
        clearstatcache();

        $modified = collect(File::glob($directory.DIRECTORY_SEPARATOR.'*.sqlite'))
            ->filter(fn (string $path): bool => preg_match(self::ID_PATTERN, File::name($path)) === 1)
            ->mapWithKeys(fn (string $path): array => [$path => @filemtime($path)])
            ->filter(fn (int|false $modifiedAt): bool => $modifiedAt !== false)
            ->sort();

        $cutoff = $this->expiresBefore();
        [$expired, $live] = $modified->partition(fn (int $modifiedAt): bool => $modifiedAt < $cutoff);
        $excess = max(0, $live->count() + $reserve - config('casefile.sandbox.cap'));

        return $expired->keys()
            ->merge($live->keys()->take($excess))
            ->filter(fn (string $path): bool => $this->remove($path))
            ->count();
    }

    /**
     * @param  SandboxHandle  $handle
     * @return void
     */
    public function attach(SandboxHandle $handle): void
    {
        config([
            'database.connections.sqlite.database' => $handle->path,
            'database.connections.sqlite.url' => null,
        ]);
        DB::purge('sqlite');
    }

    /**
     * @param  string  $id
     * @return string
     *
     * @throws InvalidArgumentException
     */
    private function pathFor(string $id): string
    {
        if (preg_match(self::ID_PATTERN, $id) !== 1) {
            throw new InvalidArgumentException('A sandbox id is 32 lowercase hexadecimal characters.');
        }

        return config('casefile.sandbox.directory').DIRECTORY_SEPARATOR.$id.'.sqlite';
    }

    /**
     * @param  string  $path
     * @return bool
     *
     * @throws RuntimeException
     */
    private function remove(string $path): bool
    {
        if (File::delete($path)) {
            return true;
        }

        if (File::exists($path)) {
            throw new RuntimeException('Could not delete the sandbox at '.$path.'.');
        }

        return false;
    }

    /**
     * @return int
     */
    private function expiresBefore(): int
    {
        return CarbonImmutable::now()->subHours(config('casefile.sandbox.ttl_hours'))->getTimestamp();
    }

    /**
     * @return string
     *
     * @throws RuntimeException
     */
    private function templatePath(): string
    {
        $template = config('casefile.sandbox.template');

        if (! File::isFile($template)) {
            throw new RuntimeException('The sandbox template is missing at '.$template.'. Build it with php artisan casefile:build-template.');
        }

        return $template;
    }

    /**
     * @param  string  $path
     * @return ?string
     *
     * @throws PDOException
     */
    private function schemaVersion(string $path): ?string
    {
        $database = new Sqlite('sqlite:'.$path, null, null, [Sqlite::ATTR_OPEN_FLAGS => Sqlite::OPEN_READONLY]);
        $version = $database->query('select schema_version from installation_meta')->fetchColumn();

        return is_string($version) ? $version : null;
    }
}
