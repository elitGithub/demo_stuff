<?php

namespace App\Services;

use App\Data\ServiceInput;
use App\Data\StylistInput;
use App\Enums\AccountRole;
use App\Enums\ProfileStatus;
use App\Models\Service;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class StylistService
{
    /**
     * @param  User  $actor
     * @return StylistProfile
     */
    public function profile(User $actor): StylistProfile
    {
        abort_unless($actor->hasRole(AccountRole::Stylist), 403);

        return $actor->profile()->with('specialties')->firstOrFail();
    }

    /**
     * @param  StylistProfile  $profile
     * @return bool
     */
    public function profileComplete(StylistProfile $profile): bool
    {
        return trim($profile->display_name) !== '' && trim($profile->studio_name) !== '' && trim($profile->biography) !== '' && trim($profile->address) !== '' && $profile->specialties()->where('enabled', true)->exists();
    }

    /**
     * @param  User  $actor
     * @param  StylistInput  $input
     * @return StylistProfile
     *
     * @throws ValidationException
     */
    public function saveProfile(User $actor, StylistInput $input): StylistProfile
    {
        return DB::connection('visitor')->transaction(function () use ($actor, $input): StylistProfile {
            $profile = $this->profile($actor);
            Gate::forUser($actor)->authorize('update', $profile);
            if (Specialty::query()->where('enabled', true)->whereIn('id', $input->specialtyIds)->count() !== $input->specialtyIds->unique()->count()) {
                throw ValidationException::withMessages(['specialty_ids' => 'Choose available specialties.']);
            }
            if ($profile->city_code !== $input->cityCode) {
                $profile->increment('booking_lock_version');
                $availability = app(AvailabilityService::class);
                $availability->assertScheduleSafe($profile, $availability->currentSchedule($profile), config('demo.locations.'.$input->cityCode.'.timezone'), null, CarbonImmutable::now('UTC'));
            }
            if ($profile->services()->where('active', true)->whereNotIn('specialty_id', $input->specialtyIds)->exists()) {
                throw ValidationException::withMessages(['specialty_ids' => 'Keep specialties used by active services, or deactivate those services first.']);
            }
            $profile->update(['display_name' => $input->displayName, 'studio_name' => $input->studioName, 'biography' => $input->biography, 'address' => $input->address, 'city_code' => $input->cityCode, 'timezone' => config('demo.locations.'.$input->cityCode.'.timezone'), 'deposit_percent' => $input->depositPercent]);
            $profile->specialties()->sync($input->specialtyIds->all());

            return $profile->refresh();
        });
    }

    /**
     * @param  User  $actor
     * @param  ?Service  $service
     * @param  ServiceInput  $input
     * @return Service
     *
     * @throws ValidationException
     */
    public function saveService(User $actor, ?Service $service, ServiceInput $input): Service
    {
        return DB::connection('visitor')->transaction(function () use ($actor, $service, $input): Service {
            $profile = $this->profile($actor);
            if ($service !== null) {
                abort_unless($service->profile_id === $profile->id, 404);
                Gate::forUser($actor)->authorize('update', $service);
            } else {
                Gate::forUser($actor)->authorize('create', Service::class);
            }
            $retainedInactiveService = $service !== null && $service->specialty_id === $input->specialtyId && ! $input->active;
            if (! $retainedInactiveService && ! $profile->specialties()->where('specialties.id', $input->specialtyId)->where('enabled', true)->exists()) {
                throw ValidationException::withMessages(['specialty_id' => 'Choose an enabled specialty from your profile.']);
            }
            $service ??= new Service;
            $service->fill(['profile_id' => $profile->id, 'specialty_id' => $input->specialtyId, 'name' => $input->name, 'price_cents' => $input->priceCents, 'duration_minutes' => $input->durationMinutes, 'active' => $input->active]);
            $service->save();

            return $service;
        });
    }

    /**
     * @param  User  $actor
     * @return StylistProfile
     *
     * @throws ValidationException
     */
    public function submit(User $actor): StylistProfile
    {
        return DB::connection('visitor')->transaction(function () use ($actor): StylistProfile {
            $profile = $this->profile($actor);
            Gate::forUser($actor)->authorize('update', $profile);
            if ($profile->status === ProfileStatus::Suspended) {
                throw ValidationException::withMessages(['status' => 'Your profile is suspended. Only the review team can restore publication.']);
            }
            if (in_array($profile->status, [ProfileStatus::Pending, ProfileStatus::Published], true)) {
                return $profile;
            }
            $errors = [];
            foreach (['display_name' => 'Add your display name.', 'studio_name' => 'Add your studio name.', 'biography' => 'Tell clients about your approach.', 'address' => 'Add your studio address.'] as $field => $message) {
                if (trim($profile->{$field}) === '') {
                    $errors[$field] = $message;
                }
            }
            if (! $profile->specialties()->where('enabled', true)->exists()) {
                $errors['specialty_ids'] = 'Choose at least one available specialty.';
            }
            if (! $profile->services()->eligible()->whereIn('specialty_id', $profile->specialties()->select('specialties.id'))->exists()) {
                $errors['services'] = 'Add at least one active service in your selected specialties.';
            }
            if (! $profile->workingHours()->exists()) {
                $errors['weekly_hours'] = 'Add your weekly availability before submitting.';
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }
            $profile->update(['status' => ProfileStatus::Pending]);

            return $profile;
        });
    }
}
