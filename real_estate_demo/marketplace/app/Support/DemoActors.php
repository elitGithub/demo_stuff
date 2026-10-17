<?php

namespace App\Support;

use App\Models\User;

class DemoActors
{
    public static function keys(): array
    {
        return ['customer', 'provider', 'admin'];
    }

    public static function find(string $key): User
    {
        abort_unless(in_array($key, self::keys(), true), 404);

        return User::where('demo_key', $key)->where('role', $key)->firstOrFail();
    }
}
