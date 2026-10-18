<?php

namespace Elsewhere;

final readonly class RateBucket implements \JsonSerializable
{
    /** @param string $key @param int $hits @param int $expiresAt */
    public function __construct(public string $key, public int $hits, public int $expiresAt)
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', $key) || $hits < 1 || $hits > 9007199254740991 || $expiresAt < 0 || $expiresAt > 9007199254740991) { throw new \TypeError('Invalid rate bucket.'); }
    }
    /** @return array<string, string|int> */
    public function jsonSerialize(): array { return get_object_vars($this); }
}
