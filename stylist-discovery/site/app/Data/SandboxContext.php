<?php

namespace App\Data;

use Carbon\CarbonImmutable;

final readonly class SandboxContext
{
    /**
     * @param  string  $digest
     * @param  string  $generation
     * @param  CarbonImmutable  $expiresAt
     * @return void
     */
    public function __construct(public string $digest, public string $generation, public CarbonImmutable $expiresAt) {}
}
