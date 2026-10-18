<?php

namespace Elsewhere;

final readonly class RequestIdentity
{
    /** @param string $remoteAddress @param ?string $sandboxToken @param ?string $dashboardToken @param ?string $contextToken */
    public function __construct(public string $remoteAddress, public ?string $sandboxToken = null, public ?string $dashboardToken = null, public ?string $contextToken = null)
    {
        if (strlen($remoteAddress) < 1 || strlen($remoteAddress) > 255) { throw new \TypeError('Invalid request identity.'); }
    }
}
