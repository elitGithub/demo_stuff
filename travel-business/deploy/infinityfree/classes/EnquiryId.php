<?php

namespace Elsewhere;

final readonly class EnquiryId implements \JsonSerializable
{
    /** @param int $id */
    public function __construct(public int $id)
    {
        if ($id < 1 || $id > 9007199254740991) { throw new DemoError('Invalid enquiry ID.'); }
    }

    /** @return array<string, int> */
    public function jsonSerialize(): array { return ['id' => $this->id]; }
}
