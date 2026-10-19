<?php

namespace Elsewhere;

final readonly class Acknowledgement implements \JsonSerializable
{
    /** @param bool $ok */
    public function __construct(public bool $ok = true)
    {
        if (!$ok) { throw new \TypeError('Acknowledgements must be successful.'); }
    }
    /** @return array<string, bool> */
    public function jsonSerialize(): array { return ['ok' => $this->ok]; }
}
