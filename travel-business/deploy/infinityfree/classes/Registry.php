<?php

namespace Elsewhere;

final readonly class Registry implements \JsonSerializable
{
    /** @param array<string, SandboxRecord> $sandboxes @param array<string, RateBucket> $rateBuckets @param int $version */
    public function __construct(public array $sandboxes, public array $rateBuckets, public int $version = 1)
    {
        if ($version !== 1) { throw new \TypeError('Invalid registry version.'); }
        foreach ($sandboxes as $key => $record) { if (!$record instanceof SandboxRecord || $key !== $record->digest) { throw new \TypeError('Invalid registry sandbox.'); } }
        foreach ($rateBuckets as $key => $bucket) { if (!$bucket instanceof RateBucket || $key !== $bucket->key) { throw new \TypeError('Invalid registry bucket.'); } }
    }
    /** @return array<string, mixed> */
    public function jsonSerialize(): array { return ['version' => $this->version, 'sandboxes' => (object) $this->sandboxes, 'rateBuckets' => (object) $this->rateBuckets]; }
}
