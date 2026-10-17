<?php

namespace App\Data;

final readonly class SandboxHandle
{
    /**
     * @param  string  $id
     * @param  string  $path
     */
    public function __construct(
        public string $id,
        public string $path,
    ) {}
}
