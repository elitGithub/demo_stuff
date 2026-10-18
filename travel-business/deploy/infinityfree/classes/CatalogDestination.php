<?php

namespace Elsewhere;

final readonly class CatalogDestination implements \JsonSerializable
{
    /** @param string $id @param string $name */
    public function __construct(public string $id, public string $name) {}
    /** @return array<string, string> */
    public function jsonSerialize(): array { return get_object_vars($this); }
}
