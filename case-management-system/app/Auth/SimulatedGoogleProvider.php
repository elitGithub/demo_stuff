<?php

namespace App\Auth;

use App\Contracts\SignInProvider;
use App\Data\OwnerIdentity;

final class SimulatedGoogleProvider implements SignInProvider
{
    /**
     * @return OwnerIdentity
     */
    public function authenticate(): OwnerIdentity
    {
        return new OwnerIdentity(
            email: config('casefile.owner.email'),
            name: config('casefile.owner.name'),
            googleSubject: 'simulated-google-owner',
        );
    }
}
