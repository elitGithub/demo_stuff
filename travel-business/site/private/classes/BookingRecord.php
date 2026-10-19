<?php

namespace Elsewhere;

final readonly class BookingRecord implements \JsonSerializable
{
    /** @param int $id @param string $reference @param ?int $enquiryId @param string $firstName @param string $lastName @param string $destination @param string $journey @param string $departure @param int $travelers @param int $value @param BookingStatus $status @param string $createdAt */
    public function __construct(public int $id, public string $reference, public ?int $enquiryId, public string $firstName, public string $lastName, public string $destination, public string $journey, public string $departure, public int $travelers, public int $value, public BookingStatus $status, public string $createdAt) {}

    /** @return array<string, mixed> */
    public function jsonSerialize(): array { return [...get_object_vars($this), 'status' => $this->status->value]; }
}
