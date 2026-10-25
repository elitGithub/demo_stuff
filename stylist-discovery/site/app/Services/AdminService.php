<?php

namespace App\Services;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\ProfileStatus;
use App\Models\Booking;
use App\Models\Specialty;
use App\Models\StylistProfile;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class AdminService
{
    /** @param User $actor
     * @param StylistProfile $profile
     * @return StylistProfile */
    public function publish(User $actor, StylistProfile $profile): StylistProfile
    {
        abort_unless($actor->hasRole(AccountRole::Admin), 403);

        return DB::connection('visitor')->transaction(function () use ($profile): StylistProfile {
            $profile->increment('booking_lock_version');
            $profile->refresh();
            abort_unless(in_array($profile->status, [ProfileStatus::Pending, ProfileStatus::Suspended], true), 409, 'Only submitted or suspended profiles can be published.');
            if (! app(StylistService::class)->profileComplete($profile) || ! $profile->services()->eligible()->whereIn('specialty_id', $profile->specialties()->select('specialties.id'))->exists() || ! $profile->workingHours()->exists()) {
                throw ValidationException::withMessages(['profile' => 'Complete the studio details, an available service and weekly hours before publishing.']);
            }
            $profile->update(['status' => ProfileStatus::Published]);

            return $profile;
        });
    }

    /** @param User $actor
     * @param StylistProfile $profile
     * @return StylistProfile */
    public function suspend(User $actor, StylistProfile $profile): StylistProfile
    {
        abort_unless($actor->hasRole(AccountRole::Admin), 403);

        return DB::connection('visitor')->transaction(function () use ($profile): StylistProfile {
            $profile->increment('booking_lock_version');
            $profile->refresh();
            abort_unless($profile->status === ProfileStatus::Published, 409, 'Only published profiles can be suspended.');
            $profile->update(['status' => ProfileStatus::Suspended]);

            return $profile;
        });
    }

    /** @param User $actor
     * @param Specialty $specialty
     * @param bool $enabled
     * @return Specialty */
    public function setSpecialty(User $actor, Specialty $specialty, bool $enabled): Specialty
    {
        Gate::forUser($actor)->authorize('update', $specialty);

        return DB::connection('visitor')->transaction(function () use ($specialty, $enabled): Specialty {
            $specialty->update(['enabled' => $enabled]);

            return $specialty;
        });
    }

    /** @param int $page
     * @return LengthAwarePaginator<StylistProfile> */
    public function applications(int $page): LengthAwarePaginator
    {
        return StylistProfile::query()->with('user')->orderByRaw('CASE status WHEN ? THEN 0 WHEN ? THEN 1 WHEN ? THEN 2 ELSE 3 END', [ProfileStatus::Pending->value, ProfileStatus::Suspended->value, ProfileStatus::Published->value])->orderBy('display_name')->orderBy('id')->paginate(config('demo.pagination'), ['*'], 'page', $page);
    }

    /** @param CarbonImmutable $now
     * @return void */
    public function expireBookings(CarbonImmutable $now): void
    {
        foreach (StylistProfile::query()->whereHas('bookings')->orderBy('id')->limit(config('demo.limits.profiles'))->get() as $profile) {
            app(BookingService::class)->expireFor($profile, $now);
        }
    }

    /** @param ?BookingStatus $status
     * @param int $page
     * @param CarbonImmutable $now
     * @return LengthAwarePaginator<Booking> */
    public function bookings(?BookingStatus $status, int $page, CarbonImmutable $now): LengthAwarePaginator
    {
        $this->expireBookings($now);

        return Booking::query()->with(['profile', 'client', 'payments'])->when($status !== null, fn ($query) => $query->where('status', $status))->orderByDesc('starts_at')->orderByDesc('id')->paginate(config('demo.pagination'), ['*'], 'page', $page);
    }
}
