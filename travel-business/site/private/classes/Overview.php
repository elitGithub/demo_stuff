<?php

namespace Elsewhere;

final readonly class Overview implements \JsonSerializable
{
    /** @param EnquiryRecord[] $enquiries @param BookingRecord[] $bookings @param Catalog $catalog */
    public function __construct(public array $enquiries, public array $bookings, public Catalog $catalog)
    {
        foreach ($enquiries as $enquiry) { if (!$enquiry instanceof EnquiryRecord) { throw new \TypeError('Invalid enquiry collection.'); } }
        foreach ($bookings as $booking) { if (!$booking instanceof BookingRecord) { throw new \TypeError('Invalid booking collection.'); } }
    }
    /** @return array<string, mixed> */
    public function jsonSerialize(): array { return get_object_vars($this); }
}
