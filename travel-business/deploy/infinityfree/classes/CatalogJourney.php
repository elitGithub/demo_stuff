<?php

namespace Elsewhere;

final readonly class CatalogJourney implements \JsonSerializable
{
    /** @param string $id @param string $title @param string $destination @param int $price */
    public function __construct(public string $id, public string $title, public string $destination, public int $price) {}
    /** @return array<string, string> */
    public function jsonSerialize(): array { return ['id' => $this->id, 'title' => $this->title]; }
}
