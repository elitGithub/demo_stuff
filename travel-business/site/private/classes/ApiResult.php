<?php

namespace Elsewhere;

final readonly class ApiResult
{
    /** @param Bootstrap|Overview|CreatedEnquiry|CreatedBooking|Acknowledgement $payload @param CookieChange[] $cookies */
    public function __construct(public Bootstrap|Overview|CreatedEnquiry|CreatedBooking|Acknowledgement $payload, public array $cookies)
    {
        foreach ($cookies as $cookie) { if (!$cookie instanceof CookieChange) { throw new \TypeError('Invalid cookie collection.'); } }
    }
}
