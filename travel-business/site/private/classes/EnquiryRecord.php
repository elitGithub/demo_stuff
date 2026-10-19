<?php

namespace Elsewhere;

final readonly class EnquiryRecord implements \JsonSerializable
{
    /** @param int $id @param string $reference @param EnquiryInput $input @param EnquiryStatus $status @param string $createdAt */
    public function __construct(public int $id, public string $reference, public EnquiryInput $input, public EnquiryStatus $status, public string $createdAt) {}

    /** @return array<string, string|int> */
    public function jsonSerialize(): array { return ['id' => $this->id, 'reference' => $this->reference, ...$this->input->jsonSerialize(), 'status' => $this->status->value, 'createdAt' => $this->createdAt]; }
}
