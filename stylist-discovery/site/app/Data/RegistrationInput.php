<?php

namespace App\Data;

use App\Enums\AccountRole;

final readonly class RegistrationInput
{
    /**
     * @param  string  $name
     * @param  string  $email
     * @param  string  $password
     * @param  AccountRole  $role
     * @return void
     */
    public function __construct(public string $name, public string $email, public string $password, public AccountRole $role) {}
}
