<?php

namespace Elsewhere;

final readonly class CreatedBooking implements \JsonSerializable
{
    /** @param string $reference */
    public function __construct(public string $reference) {}
    /** @return array<string, string> */
    public function jsonSerialize(): array { return get_object_vars($this); }
}
