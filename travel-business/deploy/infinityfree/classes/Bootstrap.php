<?php

namespace Elsewhere;

final readonly class Bootstrap implements \JsonSerializable
{
    /** @param string $csrfToken @param int $expiresAt @param bool $created @param int $protocolVersion @param int $idleSeconds @param int $pageSize */
    public function __construct(public string $csrfToken, public int $expiresAt, public bool $created, public int $protocolVersion, public int $idleSeconds, public int $pageSize) {}
    /** @return array<string, string|int|bool> */
    public function jsonSerialize(): array { return get_object_vars($this); }
}
