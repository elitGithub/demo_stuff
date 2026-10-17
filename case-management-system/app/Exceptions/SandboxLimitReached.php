<?php

namespace App\Exceptions;

use RuntimeException;

final class SandboxLimitReached extends RuntimeException
{
    /**
     * @param  string  $message
     * @param  int  $retryAfterSeconds
     */
    public function __construct(string $message, public readonly int $retryAfterSeconds)
    {
        parent::__construct($message);
    }
}
