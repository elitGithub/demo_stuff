<?php

namespace App\Data;

final readonly class LoginInput
{
    /**
     * @param  string  $email
     * @param  string  $password
     * @return void
     */
    public function __construct(public string $email, public string $password) {}
}
