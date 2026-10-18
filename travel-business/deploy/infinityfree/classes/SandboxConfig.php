<?php

namespace Elsewhere;

final readonly class SandboxConfig implements \JsonSerializable
{
    public int $protocolVersion;
    public int $idleSeconds;
    public int $maxSandboxes;
    public int $maxDatabaseBytes;
    public int $maxRuntimeBytes;
    public int $maxEnquiries;
    public int $cleanupBatch;
    public int $maxRateBuckets;
    public int $allocationLimit;
    public int $enquiryLimit;
    public int $loginLimit;
    public int $rateWindowSeconds;
    public int $pageSize;
    public int $sqlitePageBytes;
    public int $registryReserveBytes;
    public int $journalReserveBytes;
    public int $stagingReserveBytes;
    public int $lockWaitMilliseconds;
    public int $lockRetryMilliseconds;
    public string $sandboxCookie;
    public string $dashboardCookie;

    /** @param object $raw */
    public function __construct(object $raw)
    {
        $defaultsPath = is_file(dirname(__DIR__).'/sandbox.json') ? dirname(__DIR__).'/sandbox.json' : dirname(__DIR__, 3).'/config/sandbox.json';
        $defaults = json_decode(file_get_contents($defaultsPath), flags: JSON_THROW_ON_ERROR);
        foreach (get_object_vars($raw) as $key => $value) { if (!property_exists($defaults, $key)) { throw new \TypeError('Unknown sandbox configuration key.'); } }
        $values = (object) [...get_object_vars($defaults), ...get_object_vars($raw)];
        foreach ($defaults as $key => $default) {
            if (is_int($default) && is_float($values->$key) && is_finite($values->$key) && floor($values->$key) === $values->$key && $values->$key <= 9007199254740991 && $values->$key >= 1) { $values->$key = (int) $values->$key; }
            if (is_int($default) && (!is_int($values->$key) || $values->$key < 1 || $values->$key > 9007199254740991)) { throw new \TypeError('Invalid sandbox configuration value.'); }
        }
        if ($values->protocolVersion !== 1 || $values->sqlitePageBytes !== 4096 || $values->maxDatabaseBytes % 4096 !== 0 || $values->maxDatabaseBytes < 32768 || $values->maxDatabaseBytes > 1048576 || $values->maxEnquiries < 4 || $values->maxEnquiries > 100 || $values->maxSandboxes > 100 || $values->maxRateBuckets > 1000 || $values->maxRuntimeBytes > 134217728 || $values->cleanupBatch > 10 || $values->pageSize !== 20 || $values->lockRetryMilliseconds > $values->lockWaitMilliseconds) { throw new \TypeError('Invalid sandbox bounds.'); }
        $reservation = $values->maxSandboxes * $values->maxDatabaseBytes + $values->registryReserveBytes + $values->journalReserveBytes + $values->stagingReserveBytes;
        if ($reservation > 9007199254740991 || $reservation > $values->maxRuntimeBytes || $values->registryReserveBytes < 2097152 || $values->journalReserveBytes < 2 * $values->maxDatabaseBytes || $values->stagingReserveBytes < 2 * $values->maxDatabaseBytes) { throw new \TypeError('Insufficient sandbox storage reservation.'); }
        if (!is_string($values->sandboxCookie) || !is_string($values->dashboardCookie) || !preg_match('/^[a-z][a-z0-9_]{0,63}$/D', $values->sandboxCookie) || !preg_match('/^[a-z][a-z0-9_]{0,63}$/D', $values->dashboardCookie) || $values->sandboxCookie === $values->dashboardCookie) { throw new \TypeError('Invalid sandbox cookie names.'); }
        foreach ($values as $key => $value) { $this->$key = $value; }
    }
    /** @param object $raw @return self */
    public static function from(object $raw): self { return new self(raw: $raw); }
    /** @return array<string, string|int> */
    public function jsonSerialize(): array { return get_object_vars($this); }
}
