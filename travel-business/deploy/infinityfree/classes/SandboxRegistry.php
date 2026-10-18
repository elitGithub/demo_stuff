<?php

namespace Elsewhere;

final class SandboxRegistry
{
    private bool           $newLock = false;
    public readonly string $root;

    /** @param string $root @param SandboxConfig $config */
    public function __construct(string $root, public readonly SandboxConfig $config)
    {
        if ($root === '' || !str_starts_with($root, '/') || preg_match('~(?:^|/)\.\.(?:/|$)~', $root)) {
            throw new \TypeError('Explicit absolute runtime root required.');
        }
        $this->root = '/' . implode(
                '/',
                array_filter(
                    explode('/', $root),
                    fn(string $component): bool => $component !== '' && $component !== '.'
                )
            );
    }

    /** @return resource */
    public function acquire(): mixed
    {
        $descriptor = null;
        try {
            $this->prepareRoot();
            $path = $this->root . '/runtime.lock';
            if (@lstat($path) === false) {
                $entries = $this->entries($this->root, $this->config->maxSandboxes + 3);
                clearstatcache(true, $path);
                if ($entries !== [] && @lstat($path) === false) {
                    throw new \TypeError('Cannot initialize a nonempty runtime root.');
                }
            }
            $previousMask = umask(0077);
            try {
                $descriptor = @fopen($path, 'x+b');
            } finally {
                umask($previousMask);
            }
            $this->newLock = $descriptor !== false;
            if (!$this->newLock) {
                $this->file($path, 0);
                $descriptor = fopen($path, 'r+b');
            } elseif (!chmod($path, 0600)) {
                throw new \RuntimeException('Cannot protect runtime lock.');
            }
            if ($descriptor === false) {
                throw new \RuntimeException('Cannot open runtime lock.');
            }
            $information = fstat($descriptor);
            $pathInformation = lstat($path);
            if ($information['ino'] !== $pathInformation['ino'] || $information['dev'] !== $pathInformation['dev']) {
                throw new \RuntimeException('Runtime lock inode changed.');
            }
            $deadline = hrtime(true) + $this->config->lockWaitMilliseconds * 1000000;
            $incomplete = false;
            while (true) {
                if (flock($descriptor, LOCK_EX | LOCK_NB)) {
                    clearstatcache(true, $this->root . '/registry.json');
                    if ($this->newLock || @lstat($this->root . '/registry.json') !== false) {
                        break;
                    }
                    $incomplete = true;
                    flock($descriptor, LOCK_UN);
                }
                $remaining = $deadline - hrtime(true);
                if ($remaining <= 0) {
                    if ($incomplete) {
                        throw new DemoError(
                                      'The demo storage is unavailable.',
                                      503,
                                      ErrorCode::Unavailable,
                            previous: new \RuntimeException('Incomplete runtime metadata.')
                        );
                    }
                    throw new DemoError('The demo is busy. Please try again.', 503, ErrorCode::Busy, 2);
                }
                usleep((int)min($remaining / 1000, $this->config->lockRetryMilliseconds * 1000, 25000));
            }
            return $descriptor;
        } catch (\Throwable $error) {
            if (is_resource($descriptor)) {
                fclose($descriptor);
            }
            throw $this->unavailable($error);
        }
    }

    /** @return Registry */
    public function load(): Registry
    {
        try {
            $this->prepareRoot();
            $entries = $this->entries($this->root, $this->config->maxSandboxes + 3);
            if ($this->newLock && $entries === ['runtime.lock']) {
                $registry = new Registry(sandboxes: [], rateBuckets: []);
                $this->save($registry);
                return $registry;
            }
            if (!in_array('registry.json', $entries, true) || !in_array('runtime.lock', $entries, true)) {
                throw new \TypeError('Incomplete runtime metadata.');
            }
            $this->file($this->root . '/registry.json', 1048576);
            $encoded = file_get_contents($this->root . '/registry.json');
            $raw = json_decode($encoded, flags: JSON_THROW_ON_ERROR);
            if (!$this->shape($raw, ['version', 'sandboxes', 'rateBuckets']
                ) || $raw->version !== 1 || !$raw->sandboxes instanceof \stdClass || !$raw->rateBuckets instanceof \stdClass || count(
                                                                                                                                    get_object_vars(
                                                                                                                                        $raw->sandboxes
                                                                                                                                    )
                                                                                                                                ) > $this->config->maxSandboxes || count(
                                                                                                                                                                       get_object_vars(
                                                                                                                                                                           $raw->rateBuckets
                                                                                                                                                                       )
                                                                                                                                                                   ) > $this->config->maxRateBuckets || $this->encode(
                    $raw
                ) !== $encoded) {
                throw new \TypeError('Invalid registry shape.');
            }
            $sandboxes = [];
            $contexts = [];
            $authorizations = [];
            foreach ($raw->sandboxes as $key => $record) {
                if (!$this->shape($record, ['digest', 'csrfToken', 'dashboardDigest', 'lastActivity', 'state']
                    ) || $key !== $record->digest || !is_int(
                        $record->lastActivity
                    ) || $record->lastActivity > 9007199254740991 - $this->config->idleSeconds || !is_string(
                        $record->csrfToken
                    ) || isset($contexts[$record->csrfToken]) || ($record->dashboardDigest !== null && (!is_string(
                                $record->dashboardDigest
                            ) || isset($authorizations[$record->dashboardDigest]))) || ($record->state !== SandboxState::Ready->value && $record->dashboardDigest !== null)) {
                    throw new \TypeError('Invalid registry sandbox.');
                }
                $sandboxes[$key] = new SandboxRecord(
                    digest         : $record->digest,
                    csrfToken      : $record->csrfToken,
                    dashboardDigest: $record->dashboardDigest,
                    lastActivity   : $record->lastActivity,
                    state          : SandboxState::from($record->state)
                );
                $contexts[$record->csrfToken] = true;
                if ($record->dashboardDigest !== null) {
                    $authorizations[$record->dashboardDigest] = true;
                }
            }
            $rateBuckets = [];
            foreach ($raw->rateBuckets as $key => $bucket) {
                if (!$this->shape($bucket, ['key', 'hits', 'expiresAt']) || $key !== $bucket->key || !is_int(
                        $bucket->hits
                    ) || !is_int($bucket->expiresAt) || $bucket->hits > max(
                        $this->config->allocationLimit,
                        $this->config->enquiryLimit,
                        $this->config->loginLimit
                    )) {
                    throw new \TypeError('Invalid registry rate bucket.');
                }
                $rateBuckets[$key] = new RateBucket(
                    key      : $bucket->key,
                    hits     : $bucket->hits,
                    expiresAt: $bucket->expiresAt
                );
            }
            $registry = new Registry(sandboxes: $sandboxes, rateBuckets: $rateBuckets, version: $raw->version);
            $this->extraBytes($registry);
            return $registry;
        } catch (\Throwable $error) {
            throw $this->unavailable($error);
        }
    }

    /** @param Registry $registry @return void */
    public function save(Registry $registry): void
    {
        $descriptor = null;
        try {
            if (count($registry->sandboxes) > $this->config->maxSandboxes || count(
                                                                                 $registry->rateBuckets
                                                                             ) > $this->config->maxRateBuckets) {
                throw new \TypeError('Invalid registry bounds.');
            }
            $this->prepareRoot();
            $encoded = $this->encode($registry);
            if (strlen($encoded) > 1048576) {
                throw new \TypeError('Registry exceeds image limit.');
            }
            foreach (['registry.json', 'registry.next'] as $name) {
                if (@lstat($this->root . '/' . $name) !== false) {
                    $this->file($this->root . '/' . $name, 1048576);
                }
            }
            $descriptor = fopen($this->root . '/registry.next', 'wb');
            if ($descriptor === false || !chmod($this->root . '/registry.next', 0600)) {
                throw new \RuntimeException('Cannot stage registry.');
            }
            if (fwrite($descriptor, $encoded) !== strlen($encoded) || !fflush($descriptor) || !fsync($descriptor)) {
                throw new \RuntimeException('Cannot persist registry.');
            }
            fclose($descriptor);
            $descriptor = null;
            if (!rename($this->root . '/registry.next', $this->root . '/registry.json')) {
                throw new \RuntimeException('Cannot replace registry.');
            }
            $this->syncDirectory($this->root);
        } catch (\Throwable $error) {
            throw $this->unavailable($error);
        } finally {
            if (is_resource($descriptor)) {
                fclose($descriptor);
            }
        }
    }

    /** @param Registry $registry @return int */
    public function extraBytes(Registry $registry): int
    {
        try {
            $this->prepareRoot();
            $directories = [];
            $extra = 0;
            foreach ($this->entries($this->root, $this->config->maxSandboxes + 3) as $name) {
                if (in_array($name, ['registry.json', 'registry.next', 'runtime.lock'], true)) {
                    $this->file($this->root . '/' . $name, $name === 'runtime.lock' ? 0 : 1048576);
                    continue;
                }
                if (!preg_match('/^[a-f0-9]{64}$/D', $name) || !isset($registry->sandboxes[$name])) {
                    throw new \TypeError('Unknown runtime entry.');
                }
                $directories[$name] = true;
                $extra += $this->inspect($registry->sandboxes[$name]);
            }
            foreach ($registry->sandboxes as $record) {
                if ($record->state === SandboxState::Ready && !isset($directories[$record->digest])) {
                    throw new \TypeError('Missing ready sandbox.');
                }
            }
            return $extra;
        } catch (\Throwable $error) {
            throw $this->unavailable($error);
        }
    }

    /** @param SandboxRecord $record @return void */
    public function remove(SandboxRecord $record): void
    {
        try {
            if ($record->state !== SandboxState::Failed) {
                throw new \TypeError('Only failed allocations may be removed.');
            }
            $this->prepareRoot();
            $directory = $this->root . '/' . $record->digest;
            if (@lstat($directory) === false) {
                return;
            }
            $this->inspect($record);
            foreach ($this->entries($directory, 4) as $name) {
                if (!unlink($directory . '/' . $name)) {
                    throw new \RuntimeException('Cannot remove sandbox file.');
                }
            }
            if (!rmdir($directory)) {
                throw new \RuntimeException('Cannot remove sandbox directory.');
            }
        } catch (\Throwable $error) {
            throw $this->unavailable($error);
        }
    }

    /** @return void */
    public function prepareRoot(): void
    {
        if (@lstat($this->root) === false && !mkdir($this->root, 0700, true)) {
            throw new \RuntimeException('Cannot create runtime root.');
        }
        $information = lstat($this->root);
        if ($information === false || ($information['mode'] & 0170000) !== 0040000 || is_link(
                $this->root
            ) || ($information['mode'] & 0077) !== 0) {
            throw new \TypeError('Unsafe runtime path.');
        }
    }

    /** @param SandboxRecord $record @return int */
    public function inspect(SandboxRecord $record): int
    {
        $directory = $this->root . '/' . $record->digest;
        $information = lstat($directory);
        if ($information === false || ($information['mode'] & 0170000) !== 0040000 || is_link(
                $directory
            ) || ($information['mode'] & 0077) !== 0) {
            throw new \TypeError('Unsafe sandbox directory.');
        }
        $main = false;
        $extra = 0;
        foreach ($this->entries($directory, 4) as $name) {
            if (!in_array($name, ['demo.sqlite', 'seed.sqlite', 'demo.sqlite-journal', 'seed.sqlite-journal'], true)) {
                throw new \TypeError('Unknown sandbox artifact.');
            }
            $bytes = $this->file(
                $directory . '/' . $name,
                str_ends_with(
                    $name,
                    '-journal'
                ) ? $this->config->journalReserveBytes : $this->config->maxDatabaseBytes
            );
            if ($name === 'demo.sqlite') {
                $main = true;
            } else {
                $extra += $bytes;
            }
        }
        if ($record->state === SandboxState::Ready && !$main) {
            throw new \TypeError('Missing ready database.');
        }
        return $extra;
    }

    /** @param string $directory @param int $limit @return string[] */
    public function entries(string $directory, int $limit): array
    {
        $descriptor = opendir($directory);
        if ($descriptor === false) {
            throw new \RuntimeException('Cannot inspect directory.');
        }
        $names = [];
        try {
            while (($name = readdir($descriptor)) !== false) {
                if ($name === '.' || $name === '..') {
                    continue;
                }
                if (count($names) >= $limit) {
                    throw new \TypeError('Too many runtime entries.');
                }
                $names[] = $name;
            }
        } finally {
            closedir($descriptor);
        }
        return $names;
    }

    /** @param string $path @param int $maximum @return int */
    public function file(string $path, int $maximum): int
    {
        clearstatcache(true, $path);
        $information = lstat($path);
        if ($information === false || ($information['mode'] & 0170000) !== 0100000 || is_link(
                $path
            ) || $information['nlink'] !== 1 || $information['size'] > $maximum || ($information['mode'] & 0077) !== 0) {
            throw new \TypeError('Unsafe runtime file.');
        }
        return $information['size'];
    }

    /** @param mixed $value @param string[] $fields @return bool */
    public function shape(mixed $value, array $fields): bool
    {
        if (!$value instanceof \stdClass || count(get_object_vars($value)) !== count($fields)) {
            return false;
        }
        foreach ($fields as $field) {
            if (!property_exists($value, $field)) {
                return false;
            }
        }
        return true;
    }

    /** @param mixed $value @return string */
    public function encode(mixed $value): string
    {
        return json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /** @param string $path @return void */
    public function syncDirectory(string $path): void
    {
        $descriptor = fopen($path, 'r');
        if ($descriptor === false) {
            throw new \RuntimeException('Cannot open directory for persistence.');
        }
        try {
            if (!fsync($descriptor)) {
                throw new \RuntimeException('Cannot persist directory.');
            }
        } finally {
            fclose($descriptor);
        }
    }

    /** @param \Throwable $cause @return DemoError */
    public function unavailable(\Throwable $cause): DemoError
    {
        return $cause instanceof DemoError ? $cause : new DemoError(
                      'The demo storage is unavailable.',
                      503,
                      ErrorCode::Unavailable,
            previous: $cause
        );
    }
}
