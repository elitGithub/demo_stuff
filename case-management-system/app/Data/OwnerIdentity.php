<?php

namespace App\Data;

final readonly class OwnerIdentity
{
    /**
     * @param  string  $email
     * @param  string  $name
     * @param  string  $googleSubject
     */
    public function __construct(
        public string $email,
        public string $name,
        public string $googleSubject,
    ) {}
}
