<?php

namespace App\Actions\Auth;

use App\Data\OwnerIdentity;
use App\Exceptions\OwnerNotFound;
use App\Models\User;
use Illuminate\Support\Facades\Auth;

final class SignInOwner
{
    /**
     * @param  OwnerIdentity  $identity
     * @return User
     *
     * @throws OwnerNotFound
     */
    public function __invoke(OwnerIdentity $identity): User
    {
        $email = mb_strtolower(trim($identity->email));
        $user = User::query()->where('email', $email)->first();

        if ($user === null) {
            throw new OwnerNotFound('No owner account matches '.$email.'.');
        }

        if ($user->google_subject !== $identity->googleSubject) {
            $user->fill(['google_subject' => $identity->googleSubject])->save();
        }

        Auth::login($user);
        session()->regenerate();

        return $user;
    }
}
