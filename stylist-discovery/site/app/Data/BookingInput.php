<?php

namespace App\Data;

readonly class BookingInput
{
    /**
     * @param  int  $serviceId
     * @param  string  $startsLocal
     * @param  string  $requestKey
     * @param  ?string  $note
     */
    public function __construct(public int $serviceId, public string $startsLocal, public string $requestKey, public ?string $note) {}
}
