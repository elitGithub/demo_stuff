<?php

namespace Elsewhere;

final class DemoError extends \RuntimeException
{
    /** @var CookieChange[] */
    public array $cookies = [];

    /** @param string $message @param int $status @param ErrorCode $errorCode @param ?int $retryAfter @param ?\Throwable $previous */
    public function __construct(string $message, public readonly int $status = 400, public readonly ErrorCode $errorCode = ErrorCode::Validation, public readonly ?int $retryAfter = null, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
