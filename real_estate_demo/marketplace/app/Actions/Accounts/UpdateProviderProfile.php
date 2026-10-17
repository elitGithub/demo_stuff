<?php

namespace App\Actions\Accounts;

use App\Enums\Role;
use App\Models\ProviderProfile;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class UpdateProviderProfile
{
    public function handle(User $actor, array $validated): ProviderProfile
    {
        abort_unless($actor->role === Role::Provider, 403);

        return DB::transaction(function () use ($actor, $validated): ProviderProfile {
            $profile = $actor->profile()->lockForUpdate()->firstOrFail();
            $profile->update([
                'business_name' => $validated['business_name'],
                'bio' => $validated['bio'],
                'service_areas' => array_values($validated['service_areas']),
            ]);
            $profile->categories()->sync($validated['category_ids']);

            return $profile;
        });
    }
}
