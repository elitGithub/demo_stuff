<?php

namespace App\Actions\Admin;

use App\Enums\ProviderStatus;
use App\Enums\Role;
use App\Exceptions\WorkflowConflict;
use App\Models\ProviderProfile;
use App\Models\User;
use App\Notifications\MarketplaceNotification;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;

class ChangeProviderStatus
{
    public function handle(User $actor, ProviderProfile $profile, ProviderStatus $target): ProviderProfile
    {
        if ($actor->role !== Role::Admin) {
            throw new AuthorizationException;
        }

        return DB::transaction(function () use ($profile, $target): ProviderProfile {
            $current = ProviderProfile::whereKey($profile->id)->lockForUpdate()->firstOrFail();
            if ($current->user->demo_key !== null) {
                throw new WorkflowConflict('This profile is a protected demo identity.');
            }
            if ($current->status === $target) {
                return $current;
            }
            $allowed = match ($current->status) {
                ProviderStatus::Pending, ProviderStatus::Suspended => ProviderStatus::Approved,
                ProviderStatus::Approved => ProviderStatus::Suspended,
            };
            if ($target !== $allowed) {
                throw new WorkflowConflict('This provider status change is unavailable.');
            }
            if ($target === ProviderStatus::Approved) {
                $areas = $current->service_areas;
                if (trim($current->business_name) === '' || trim($current->bio) === ''
                    || empty($areas) || array_diff($areas, config('marketplace.service_areas')) !== []
                    || ! $current->categories()->where('is_active', true)->exists()) {
                    throw new WorkflowConflict('Complete the business name, bio, service areas and an active category before approval.');
                }
            }
            $current->update(['status' => $target]);
            $current->user->notify(new MarketplaceNotification(
                'Your provider profile was updated',
                $target === ProviderStatus::Approved ? 'Your profile is approved. You can now respond to matching opportunities.' : 'Your profile is suspended. Previous conversations remain available to read.',
                'profile.edit',
            ));

            return $current;
        }, 3);
    }
}
