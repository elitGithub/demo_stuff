<?php

namespace Elsewhere;

final readonly class StatusChange implements \JsonSerializable
{
    /** @param int $id @param EnquiryStatus $status */
    public function __construct(public int $id, public EnquiryStatus $status)
    {
        new EnquiryId(id: $id);
        if ($status === EnquiryStatus::Converted) { throw new DemoError('Please choose a valid enquiry status.'); }
    }

    /** @return array<string, int|string> */
    public function jsonSerialize(): array { return ['id' => $this->id, 'status' => $this->status->value]; }
}
