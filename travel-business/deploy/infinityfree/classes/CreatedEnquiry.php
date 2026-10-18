<?php

namespace Elsewhere;

final readonly class CreatedEnquiry implements \JsonSerializable
{
    /** @param int $id @param string $reference */
    public function __construct(public int $id, public string $reference) {}
    /** @return array<string, int|string> */
    public function jsonSerialize(): array { return get_object_vars($this); }
}
