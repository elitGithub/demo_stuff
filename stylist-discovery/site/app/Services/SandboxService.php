<?php

namespace App\Services;

use App\Data\SandboxContext;
use App\Enums\SandboxStatus;
use App\Enums\UploadStatus;
use App\Models\Registry\Sandbox;
use App\Models\Registry\SandboxFile;
use App\Models\SandboxMeta;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Session\Session;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class SandboxService
{
    /**
     * @param  FixtureService  $fixtures
     * @return void
     */
    public function __construct(public readonly FixtureService $fixtures) {}

    /**
     * @return void
     */
    public function prepareRegistry(): void
    {
        $this->fixtures->configureConnection('registry', $this->path('registry.sqlite'), config('demo.limits.registry_pages'));
        $store = Cache::store('database')->getStore();
        $store->setConnection(DB::connection('registry'));
        $store->setLockConnection(DB::connection('registry'));
    }

    /**
     * @param  string  $filename
     * @return string
     *
     * @throws RuntimeException
     */
    public function path(string $filename): string
    {
        $root = config('demo.runtime_path');
        if (! is_string($root) || realpath($root) !== $root || is_link($root) || preg_match('/\A(?:registry\.sqlite|[0-9a-f]{64}\.sqlite(?:-journal)?|[0-9a-f]{64}\.(?:jpg|png))\z/', $filename) !== 1) {
            throw new RuntimeException('Invalid private runtime path.');
        }
        $path = $root.'/'.$filename;
        if (is_link($path)) {
            throw new RuntimeException('Runtime symbolic links are forbidden.');
        }

        return $path;
    }

    /**
     * @param  Session  $session
     * @param  string  $connectionIp
     * @param  CarbonImmutable  $now
     * @return SandboxContext
     *
     * @throws Throwable
     */
    public function enter(Session $session, string $connectionIp, CarbonImmutable $now): SandboxContext
    {
        if ($session->has('sandbox_token')) {
            return $this->admit($session, $now);
        }
        $this->reclaim($now);
        $key = 'allocate:'.hash_hmac('sha256', $connectionIp, config('app.key'));
        DB::connection('registry')->transaction(function () use ($key): void {
            if (RateLimiter::tooManyAttempts($key, config('demo.rate_limits.allocate'))) {
                throw new HttpException(429, 'Please try again later.');
            }
            RateLimiter::hit($key, config('demo.rate_limits.allocate_seconds'));
        });
        $token = bin2hex(random_bytes(32));
        $digest = hash('sha256', $token);
        $generation = bin2hex(random_bytes(16));
        $expiresAt = $now->addHours(config('demo.limits.idle_hours'));
        DB::connection('registry')->transaction(function () use ($digest, $generation, $expiresAt, $now): void {
            Sandbox::query()->create(['digest' => $digest, 'generation' => $generation, 'status' => SandboxStatus::Allocating, 'expires_at' => $expiresAt, 'allocated_at' => $now]);
        });
        try {
            $template = config('demo.template_path');
            if (! is_file($template) || is_link($template) || realpath(dirname($template)) !== config('demo.runtime_path')) {
                throw new RuntimeException('Pristine template is unavailable.');
            }
            $destination = $this->path($digest.'.sqlite');
            $source = fopen($template, 'rb');
            if ($source === false) {
                throw new RuntimeException('Cannot copy pristine template.');
            }
            try {
                $target = fopen($destination, 'xb');
                if ($target === false) {
                    throw new RuntimeException('Cannot create visitor file.');
                }
                try {
                    if (stream_copy_to_stream($source, $target) !== filesize($template)) {
                        throw new RuntimeException('Incomplete template copy.');
                    }
                } finally {
                    fclose($target);
                }
            } finally {
                fclose($source);
            }
            if (! chmod($destination, 0600)) {
                throw new RuntimeException('Cannot secure visitor file.');
            }
            $this->fixtures->configureConnection('visitor', $destination, config('demo.limits.visitor_pages'));
            $this->fixtures->initializeVisitor($now);
            SandboxMeta::query()->sole()->update(['generation' => $generation]);
            $activated = Sandbox::query()->whereKey($digest)->where('generation', $generation)->where('status', SandboxStatus::Allocating)->update(['status' => SandboxStatus::Active]);
            if ($activated !== 1) {
                throw new RuntimeException('Allocation ownership expired before activation.');
            }
            $session->put('sandbox_token', $token);
            $session->put('sandbox_generation', $generation);
            $session->put('actor_revision', bin2hex(random_bytes(16)));

            return new SandboxContext(digest: $digest, generation: $generation, expiresAt: $expiresAt);
        } catch (Throwable $exception) {
            DB::purge('visitor');
            Sandbox::query()->whereKey($digest)->where('status', SandboxStatus::Allocating)->update(['expires_at' => $now]);
            throw $exception;
        }
    }

    /**
     * @param  Session  $session
     * @param  CarbonImmutable  $now
     * @return SandboxContext
     */
    public function admit(Session $session, CarbonImmutable $now): SandboxContext
    {
        $token = $session->get('sandbox_token');
        $generation = $session->get('sandbox_generation');
        if (! is_string($token) || preg_match('/\A[0-9a-f]{64}\z/', $token) !== 1 || ! is_string($generation)) {
            throw new HttpException(410, 'This demo session has expired.');
        }
        $digest = hash('sha256', $token);
        $this->reclaimUploads($now, null, $digest);
        $expiresAt = $now->addHours(config('demo.limits.idle_hours'));
        $renewed = Sandbox::query()->whereKey($digest)->where('generation', $generation)->where('status', SandboxStatus::Active)->where('expires_at', '>', $now->utc()->toDateTimeString())->update(['expires_at' => $expiresAt]);
        if ($renewed !== 1) {
            throw new HttpException(410, 'This demo session has expired.');
        }
        $this->fixtures->configureConnection('visitor', $this->path($digest.'.sqlite'), config('demo.limits.visitor_pages'));

        return new SandboxContext(digest: $digest, generation: $generation, expiresAt: $expiresAt);
    }

    /**
     * @param  CarbonImmutable  $now
     * @return int
     *
     * @throws Throwable
     */
    public function reclaim(CarbonImmutable $now): int
    {
        $this->collectRegistry($now);
        $candidates = Sandbox::query()->where(function ($query) use ($now): void {
            $query->where('status', SandboxStatus::Retiring)->orWhere('expires_at', '<=', $now->utc()->toDateTimeString());
        })->orderBy('expires_at')->limit(config('demo.limits.cleanup_sandboxes'))->get();
        $reclaimed = 0;
        $remainingUploads = config('demo.limits.cleanup_uploads');
        foreach ($candidates as $sandbox) {
            $neverAdmitted = $sandbox->status === SandboxStatus::Allocating;
            $marked = Sandbox::query()->whereKey($sandbox->digest)->where('status', $sandbox->status)->where(function ($query) use ($now): void {
                $query->where('status', SandboxStatus::Retiring)->orWhere('expires_at', '<=', $now->utc()->toDateTimeString());
            })->update($neverAdmitted ? ['status' => SandboxStatus::Allocating, 'generation' => bin2hex(random_bytes(16))] : ['status' => SandboxStatus::Retiring]);
            if ($marked !== 1) {
                continue;
            }
            $files = $sandbox->files()->orderBy('id')->limit($remainingUploads)->get();
            $remainingUploads -= $files->count();
            $path = $this->path($sandbox->digest.'.sqlite');
            try {
                if (! $neverAdmitted && is_file($path)) {
                    $this->fixtures->configureConnection('visitor', $path, config('demo.limits.visitor_pages'));
                    DB::connection('visitor')->statement('BEGIN EXCLUSIVE');
                    DB::connection('visitor')->statement('COMMIT');
                    DB::purge('visitor');
                }
            } catch (QueryException $exception) {
                DB::purge('visitor');
                if (str_contains($exception->getMessage(), 'locked')) {
                    continue;
                }
                throw $exception;
            }
            try {
                foreach ($files as $file) {
                    $image = $this->path($file->storage_key);
                    if (file_exists($image) && ! unlink($image)) {
                        throw new RuntimeException('Cannot remove retired upload.');
                    }
                    $file->delete();
                }
                if ($sandbox->files()->exists()) {
                    continue;
                }
                foreach ([$path.'-journal', $path] as $ownedPath) {
                    $this->path(basename($ownedPath));
                    if (file_exists($ownedPath) && ! unlink($ownedPath)) {
                        throw new RuntimeException('Cannot remove retired visitor.');
                    }
                }
                $sandbox->delete();
                $reclaimed++;
            } catch (Throwable $exception) {
                Log::error('Sandbox reclamation failed.', ['digest' => $sandbox->digest, 'exception' => $exception]);
                throw new HttpException(503, 'Demo storage is temporarily unavailable.', $exception, ['Retry-After' => '2']);
            }
        }
        $this->reclaimUploads($now, $remainingUploads);

        return $reclaimed;
    }

    /**
     * @param  CarbonImmutable  $now
     * @param  ?int  $maximumFiles
     * @param  ?string  $sandboxDigest
     * @return void
     *
     * @throws Throwable
     */
    public function reclaimUploads(CarbonImmutable $now, ?int $maximumFiles = null, ?string $sandboxDigest = null): void
    {
        $maximumFiles = $maximumFiles === null ? config('demo.limits.cleanup_uploads') : min($maximumFiles, config('demo.limits.cleanup_uploads'));
        if ($maximumFiles <= 0) {
            return;
        }
        $files = SandboxFile::query()->where(function ($query) use ($now): void {
            $query->where('status', UploadStatus::Retiring)->orWhere(function ($reserved) use ($now): void {
                $reserved->where('status', UploadStatus::Reserved)->where('created_at', '<=', $now->subHours(config('demo.limits.idle_hours'))->utc()->toDateTimeString());
            });
        })->when($sandboxDigest !== null, fn ($query) => $query->where('sandbox_digest', $sandboxDigest))->orderBy('created_at')->orderBy('id')->limit($maximumFiles)->get();
        foreach ($files as $file) {
            $path = $this->path($file->sandbox_digest.'.sqlite');
            if (! is_file($path)) {
                continue;
            }
            $locked = false;
            try {
                $this->fixtures->configureConnection('visitor', $path, config('demo.limits.visitor_pages'));
                DB::connection('visitor')->statement('BEGIN EXCLUSIVE');
                $locked = true;
                if (DB::connection('visitor')->table('portfolio_images')->where('storage_key', $file->storage_key)->exists()) {
                    $file->update(['status' => UploadStatus::Attached]);
                } else {
                    $image = $this->path($file->storage_key);
                    if (file_exists($image) && ! unlink($image)) {
                        throw new RuntimeException('Cannot remove expired upload reservation.');
                    }
                    $file->delete();
                }
                DB::connection('visitor')->statement('COMMIT');
                $locked = false;
            } catch (QueryException $exception) {
                if (! str_contains($exception->getMessage(), 'locked')) {
                    throw $this->storageException($exception);
                }
            } catch (Throwable $exception) {
                throw $this->storageException($exception);
            } finally {
                if ($locked) {
                    DB::connection('visitor')->statement('ROLLBACK');
                }
                DB::purge('visitor');
            }
        }
    }

    /**
     * @param  CarbonImmutable  $now
     * @return void
     */
    public function collectRegistry(CarbonImmutable $now): void
    {
        foreach (['sessions' => ['last_activity', $now->subMinutes(config('session.lifetime'))->timestamp], 'revoked_sessions' => ['expires_at', $now->utc()->toDateTimeString()], 'cache' => ['expiration', $now->timestamp], 'cache_locks' => ['expiration', $now->timestamp]] as $table => [$column, $expiry]) {
            $key = in_array($table, ['cache', 'cache_locks'], true) ? 'key' : ($table === 'sessions' ? 'id' : 'digest');
            $query = DB::connection('registry')->table($table);
            $keys = (clone $query)->where($column, '<=', $expiry)->orderBy($column)->limit(config('demo.limits.cleanup_rows'))->pluck($key);
            $query->whereIn($key, $keys)->where($column, '<=', $expiry)->delete();
        }
    }

    /**
     * @param  Session  $session
     * @return void
     */
    public function authenticateSeededClient(Session $session): void
    {
        if (! Auth::check()) {
            DB::connection('registry')->table('revoked_sessions')->insert(['digest' => hash('sha256', $session->getId()), 'expires_at' => CarbonImmutable::now()->addSeconds(config('session.block_lock_seconds'))->utc()->toDateTimeString()]);
            Auth::login(User::query()->where('email', config('demo.seed_accounts.client'))->sole());
            $session->regenerateToken();
        }
    }

    /**
     * @param  Session  $session
     * @param  CarbonImmutable  $now
     * @return bool
     */
    public function restartExpiredSession(Session $session, CarbonImmutable $now): bool
    {
        $token = $session->get('sandbox_token');
        if (is_string($token) && Sandbox::query()->whereKey(hash('sha256', $token))->where('generation', $session->get('sandbox_generation'))->where('status', SandboxStatus::Active)->where('expires_at', '>', $now->utc()->toDateTimeString())->exists()) {
            return false;
        }
        DB::connection('registry')->table('revoked_sessions')->insert(['digest' => hash('sha256', $session->getId()), 'expires_at' => $now->addSeconds(config('session.block_lock_seconds'))->utc()->toDateTimeString()]);
        $session->invalidate();
        $session->regenerateToken();

        return true;
    }

    /**
     * @param  Throwable  $exception
     * @return HttpException
     */
    public function storageException(Throwable $exception): HttpException
    {
        Log::error('Demo storage request failed.', ['exception' => $exception]);
        $capacity = str_contains($exception->getMessage(), 'capacity:');

        return new HttpException($capacity ? 429 : 503, $capacity ? 'The demo is at capacity. Please try again later.' : 'Demo storage is temporarily unavailable.', $exception, $capacity ? [] : ['Retry-After' => '2']);
    }
}
