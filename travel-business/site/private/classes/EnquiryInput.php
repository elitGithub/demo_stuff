<?php

namespace Elsewhere;

final readonly class EnquiryInput implements \JsonSerializable
{
    /** @param string $firstName @param string $lastName @param string $email @param string $destination @param string $journey @param string $departure @param int $travelers @param string $budget @param string $message */
    public function __construct(public string $firstName, public string $lastName, public string $email, public string $destination, public string $journey, public string $departure, public int $travelers, public string $budget, public string $message) {}

    /** @return array<string, string|int> */
    public function jsonSerialize(): array { return get_object_vars($this); }
}
