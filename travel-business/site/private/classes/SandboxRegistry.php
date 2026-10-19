<?php

namespace Elsewhere;

final class SandboxRegistry
{
    private \PDO $database;

    /** @param string $root @param SandboxConfig $config @throws DemoError */
    public function __construct(public readonly string $root, public readonly SandboxConfig $config)
    {
        try {
            $this->database = new \PDO(
                'sqlite:' . $root . '/registry.sqlite',
                options: [
                    \PDO::ATTR_ERRMODE            => \PDO::ERRMODE_EXCEPTION,
                    \PDO::ATTR_STRINGIFY_FETCHES  => false,
                    \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC
                ]
            );
            $this->database->exec('PRAGMA busy_timeout = ' . $config->busyTimeoutMilliseconds);
            $this->database->exec('PRAGMA journal_mode = DELETE');
            $this->database->exec('PRAGMA temp_store = MEMORY');
            $this->database->exec(file_get_contents(dirname(__DIR__) . '/registry-schema.sql'));
        } catch (\Throwable $error) {
            throw $this->failure($error);
        }
    }

    /** @return void @throws DemoError */
    public function begin(): void
    {
        $this->query('BEGIN IMMEDIATE');
    }

    /** @return void @throws DemoError */
    public function commit(): void
    {
        $this->query('COMMIT');
    }

    /** @return void */
    public function rollback(): void
    {
        try {
            if ($this->database->inTransaction()) {
                $this->query('ROLLBACK');
            }
        } catch (\Throwable $error) {
            error_log('Sandbox rollback failed: ' . $error);
        }
    }

    /** @param int $timestamp @return string[] @throws DemoError */
    public function expire(int $timestamp): array
    {
        $this->query('DELETE FROM rate_buckets WHERE expiresAt <= ?', [$timestamp]);
        $digests = array_column(
            $this->query(
                'SELECT digest FROM sandboxes WHERE lastActivity + ? <= ? ORDER BY lastActivity, rowid LIMIT ?',
                [$this->config->idleSeconds, $timestamp, $this->config->cleanupBatch]
            ),
            'digest'
        );
        foreach ($digests as $digest) {
            $this->query('DELETE FROM sandboxes WHERE digest = ?', [$digest]);
        }
        return $digests;
    }

    /** @param string $digest @return ?SandboxRecord @throws DemoError */
    public function find(string $digest): ?SandboxRecord
    {
        try {
            $row = $this->query(
                       'SELECT digest, csrfToken, dashboardDigest, lastActivity FROM sandboxes WHERE digest = ?',
                       [$digest]
                   )[0] ?? null;
            return $row === null ? null : new SandboxRecord(
                digest         : $row['digest'],
                csrfToken      : $row['csrfToken'],
                dashboardDigest: $row['dashboardDigest'],
                lastActivity   : $row['lastActivity']
            );
        } catch (\Throwable $error) {
            throw $this->failure($error);
        }
    }

    /** @return int @throws DemoError */
    public function count(): int
    {
        return $this->query('SELECT count(*) AS sandboxes FROM sandboxes')[0]['sandboxes'];
    }

    /** @param SandboxRecord $record @return void @throws DemoError */
    public function insert(SandboxRecord $record): void
    {
        $this->query(
            'INSERT INTO sandboxes (digest, csrfToken, dashboardDigest, lastActivity) VALUES (?, ?, ?, ?)',
            [$record->digest, $record->csrfToken, $record->dashboardDigest, $record->lastActivity]
        );
    }

    /** @param SandboxRecord $record @return void @throws DemoError */
    public function update(SandboxRecord $record): void
    {
        $this->query(
            'UPDATE sandboxes SET dashboardDigest = ?, lastActivity = ? WHERE digest = ?',
            [$record->dashboardDigest, $record->lastActivity, $record->digest]
        );
    }

    /** @param string $address @param RateAction $action @param int $timestamp @return ?DemoError @throws DemoError */
    public function charge(string $address, RateAction $action, int $timestamp): ?DemoError
    {
        $key = hash('sha256', $action->value . "\0" . $address);
        $limit = match ($action) {
            RateAction::ALLOCATION => $this->config->allocationLimit,
            RateAction::ENQUIRY    => $this->config->enquiryLimit,
            RateAction::LOGIN      => $this->config->loginLimit
        };
        $previous = $this->query('SELECT hits, expiresAt FROM rate_buckets WHERE key = ?', [$key])[0] ?? null;
        $buckets = $previous === null ? $this->query(
            'SELECT count(*) AS total, min(expiresAt) AS earliest FROM rate_buckets'
        )[0] : null;
        if (($previous !== null && $previous['hits'] >= $limit) || ($buckets !== null && $buckets['total'] >= $this->config->maxRateBuckets)) {
            return new DemoError(
                'Please wait before trying this action again.',
                429,
                ErrorCode::RateLimited,
                $previous !== null ? $previous['expiresAt'] - $timestamp : $buckets['earliest'] - $timestamp
            );
        }
        if ($previous !== null) {
            $this->query('UPDATE rate_buckets SET hits = hits + 1 WHERE key = ?', [$key]);
        } else {
            $this->query(
                'INSERT INTO rate_buckets (key, hits, expiresAt) VALUES (?, 1, ?)',
                [$key, $timestamp + $this->config->rateWindowSeconds]
            );
        }
        return null;
    }

    /** @param string[] $digests @return void */
    public function deleteFiles(array $digests): void
    {
        foreach ($digests as $digest) {
            foreach ([$digest . '.sqlite', $digest . '.sqlite-journal'] as $name) {
                $path = $this->root . '/' . $name;
                try {
                    if (file_exists($path) && !unlink($path)) {
                        throw new \RuntimeException('Cannot delete ' . $path . '.');
                    }
                } catch (\Throwable $error) {
                    error_log('Sandbox cleanup failed: ' . $error);
                }
            }
        }
    }

    /** @param \Throwable $cause @return DemoError */
    public function failure(\Throwable $cause): DemoError
    {
        if ($cause instanceof DemoError) {
            return $cause;
        }
        if ($cause instanceof \PDOException && isset($cause->errorInfo[1]) && $cause->errorInfo[1] === 5) {
            return new DemoError('The demo is busy. Please try again.', 503, ErrorCode::Busy, 2);
        }
        return new DemoError(
                      'The demo storage is unavailable.',
                      503,
                      ErrorCode::Unavailable,
            previous: $cause
        );
    }

    /** @param string $sql @param array<int, string|int|null> $values @return array<int, array<string, mixed>> @throws DemoError */
    private function query(string $sql, array $values = []): array
    {
        try {
            $statement = $this->database->prepare($sql);
            foreach ($values as $index => $value) {
                $statement->bindValue(
                    $index + 1,
                    $value,
                    is_int($value) ? \PDO::PARAM_INT : ($value === null ? \PDO::PARAM_NULL : \PDO::PARAM_STR)
                );
            }
            $statement->execute();
            return $statement->fetchAll();
        } catch (\Throwable $error) {
            throw $this->failure($error);
        }
    }
}
