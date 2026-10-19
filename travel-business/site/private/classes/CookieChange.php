<?php

namespace Elsewhere;

final readonly class CookieChange
{
    /** @param string $name @param string $value @param string $path @param int $maxAge @param bool $secure */
    public function __construct(public string $name, public string $value, public string $path, public int $maxAge, public bool $secure)
    {
        if (!preg_match('/^[a-z][a-z0-9_]{0,63}$/D', $name) || ($value !== '' && !preg_match('/^[a-f0-9]{64}$/D', $value)) || !str_starts_with($path, '/') || preg_match('/[\r\n;]/', $path) || $maxAge < 0 || $maxAge > 9007199254740991) { throw new \TypeError('Invalid cookie change.'); }
    }
}
