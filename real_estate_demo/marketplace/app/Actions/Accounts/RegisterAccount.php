<?php

namespace App\Actions\Accounts;

use App\Enums\ProviderStatus;
use App\Enums\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RegisterAccount
{
    public function handle(array $validated): User
    {
        return DB::transaction(function () use ($validated): User {
            $user = new User([
                'name' => $validated['name'],
                'email' => $validated['email'],
                'password' => $validated['password'],
            ]);
            $user->role = $validated['account_type'] === 'provider' ? Role::Provider : Role::Customer;
            $user->save();

            if ($user->role === Role::Provider) {
                $user->profile()->create([
                    'business_name' => $user->name,
                    'slug' => (Str::slug($user->name) ?: 'professional').'-'.$user->id,
                    'bio' => '',
                    'service_areas' => [],
                    'status' => ProviderStatus::Pending,
                ]);
            }

            return $user;
        });
    }
}
