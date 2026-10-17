<?php

namespace App\Contracts;

use App\Data\OwnerIdentity;

interface SignInProvider
{
    /**
     * @return OwnerIdentity
     */
    public function authenticate(): OwnerIdentity;
}
