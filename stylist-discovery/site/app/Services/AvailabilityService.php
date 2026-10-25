<?php

namespace App\Services;

use App\Data\TimeOffInput;
use App\Data\TimeSlot;
use App\Data\WeeklyInterval;
use App\Data\WeeklySchedule;
use App\Models\Service;
use App\Models\StylistProfile;
use App\Models\TimeOff;
use App\Models\User;
use Carbon\CarbonImmutable;
use DateTimeZone;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class AvailabilityService
{
    /**
     * @param  string  $local
     * @param  string  $timezone
     * @return CarbonImmutable
     *
     * @throws ValidationException
     */
    public function localInstant(string $local, string $timezone): CarbonImmutable
    {
        if (! preg_match('/\A\d{4}-\d{2}-\d{2} (?:[01][0-9]|2[0-3]):[0-5][0-9]\z/', $local) || ! in_array($timezone, DateTimeZone::listIdentifiers(), true)) {
            throw ValidationException::withMessages(['starts_local' => 'Choose a valid local date and time.']);
        }
        [$year, $month, $day] = explode('-', substr($local, 0, 10));
        if (! checkdate((int) $month, (int) $day, (int) $year)) {
            throw ValidationException::withMessages(['starts_local' => 'Choose a valid local date and time.']);
        }
        $wall = CarbonImmutable::createFromFormat('!Y-m-d H:i', $local, 'UTC');
        if ($wall === false || $wall->format('Y-m-d H:i') !== $local) {
            throw ValidationException::withMessages(['starts_local' => 'Choose a valid local date and time.']);
        }
        $transitions = (new DateTimeZone($timezone))->getTransitions($wall->subDays(2)->timestamp, $wall->addDays(2)->timestamp);
        $matches = collect($transitions)->pluck('offset')->unique()->map(fn (int $offset): CarbonImmutable => $wall->subSeconds($offset))->filter(fn (CarbonImmutable $candidate): bool => $candidate->setTimezone($timezone)->format('Y-m-d H:i') === $local)->values();
        if ($matches->count() !== 1) {
            throw ValidationException::withMessages(['starts_local' => 'This local time is skipped or repeated by a clock change. Choose another time.']);
        }

        return $matches->sole();
    }

    /**
     * @param  StylistProfile  $profile
     * @return WeeklySchedule
     */
    public function currentSchedule(StylistProfile $profile): WeeklySchedule
    {
        return new WeeklySchedule(intervals: $profile->workingHours()->orderBy('weekday')->get()->map(fn ($hours): WeeklyInterval => new WeeklyInterval(weekday: $hours->weekday, opensAt: $hours->opens_at, closesAt: $hours->closes_at)));
    }

    /**
     * @param  WeeklySchedule  $schedule
     * @param  string  $timezone
     * @param  CarbonImmutable  $startsAt
     * @param  CarbonImmutable  $endsAt
     * @return bool
     */
    public function fitsSchedule(WeeklySchedule $schedule, string $timezone, CarbonImmutable $startsAt, CarbonImmutable $endsAt): bool
    {
        $start = $startsAt->setTimezone($timezone);
        $end = $endsAt->setTimezone($timezone);
        if ($startsAt->second !== 0 || $endsAt->second !== 0 || $startsAt->micro !== 0 || $endsAt->micro !== 0 || $startsAt->diffInMinutes($endsAt, false) < 15 || $startsAt->diffInMinutes($endsAt, false) > 240 || $start->minute % config('demo.booking.grid_minutes') !== 0 || $start->toDateString() !== $end->toDateString()) {
            return false;
        }
        try {
            if (! $this->localInstant($start->format('Y-m-d H:i'), $timezone)->equalTo($startsAt)) {
                return false;
            }
        } catch (ValidationException) {
            return false;
        }

        return $schedule->intervals->contains(fn (WeeklyInterval $interval): bool => $interval->weekday === $start->dayOfWeek && $interval->opensAt <= $start->format('H:i') && $interval->closesAt >= $end->format('H:i'));
    }

    /**
     * @param  Service  $service
     * @param  string  $localDate
     * @param  CarbonImmutable  $now
     * @return Collection<int, TimeSlot>
     */
    public function slots(Service $service, string $localDate, CarbonImmutable $now): Collection
    {
        $now = $now->utc();
        $profile = $service->profile;
        abort_unless($profile->isPublished() && Service::query()->eligible()->whereKey($service->id)->exists(), 404);
        $day = $this->localInstant($localDate.' 00:00', $profile->timezone);
        $nextDay = $this->localInstant($day->setTimezone($profile->timezone)->addDay()->format('Y-m-d').' 00:00', $profile->timezone);
        $schedule = $this->currentSchedule($profile);
        $occupied = $profile->bookings()->occupying($now)->where('starts_at', '<', $nextDay)->where('ends_at', '>', $day)->get();
        $timeOff = $profile->timeOff()->where('starts_at', '<', $nextDay)->where('ends_at', '>', $day)->get();
        $slots = collect();
        for ($candidate = $day; $candidate->lessThan($nextDay); $candidate = $candidate->addMinutes(config('demo.booking.grid_minutes'))) {
            $end = $candidate->addMinutes($service->duration_minutes);
            if ($candidate->lessThan($now->addHours(config('demo.booking.lead_hours'))) || $candidate->greaterThan($now->addDays(config('demo.booking.horizon_days'))) || ! $this->fitsSchedule($schedule, $profile->timezone, $candidate, $end)) {
                continue;
            }
            if ($occupied->concat($timeOff)->contains(fn ($interval): bool => $interval->starts_at->lessThan($end) && $interval->ends_at->greaterThan($candidate))) {
                continue;
            }
            $slots->push(new TimeSlot(startsAt: $candidate, endsAt: $end, timezone: $profile->timezone));
        }

        return $slots;
    }

    /**
     * @param  StylistProfile  $profile
     * @param  CarbonImmutable  $startsAt
     * @param  CarbonImmutable  $endsAt
     * @param  ?int  $exceptBookingId
     * @param  CarbonImmutable  $now
     * @return void
     *
     * @throws ValidationException
     */
    public function assertAvailable(StylistProfile $profile, CarbonImmutable $startsAt, CarbonImmutable $endsAt, ?int $exceptBookingId, CarbonImmutable $now): void
    {
        if (! $this->fitsSchedule($this->currentSchedule($profile), $profile->timezone, $startsAt, $endsAt) || $profile->timeOff()->where('starts_at', '<', $endsAt->utc())->where('ends_at', '>', $startsAt->utc())->exists() || $profile->bookings()->occupying($now)->when($exceptBookingId !== null, fn ($bookings) => $bookings->where('id', '!=', $exceptBookingId))->where('starts_at', '<', $endsAt->utc())->where('ends_at', '>', $startsAt->utc())->exists()) {
            throw ValidationException::withMessages(['starts_local' => 'This appointment no longer fits the studio schedule. Choose another time.']);
        }
    }

    /**
     * @param  StylistProfile  $profile
     * @param  WeeklySchedule  $schedule
     * @param  string  $timezone
     * @param  ?TimeOffInput  $timeOff
     * @param  CarbonImmutable  $now
     * @return void
     *
     * @throws ValidationException
     */
    public function assertScheduleSafe(StylistProfile $profile, WeeklySchedule $schedule, string $timezone, ?TimeOffInput $timeOff, CarbonImmutable $now): void
    {
        if ($schedule->intervals->count() > 7 || $schedule->intervals->pluck('weekday')->unique()->count() !== $schedule->intervals->count()) {
            throw ValidationException::withMessages(['weekly_hours' => 'Choose one opening interval per weekday.']);
        }
        foreach ($schedule->intervals as $interval) {
            if ($interval->weekday < 0 || $interval->weekday > 6 || ! preg_match('/\A(?:[01][0-9]|2[0-3]):(?:00|15|30|45)\z/', $interval->opensAt) || ! preg_match('/\A(?:[01][0-9]|2[0-3]):[0-5][0-9]\z/', $interval->closesAt) || $interval->opensAt >= $interval->closesAt) {
                throw ValidationException::withMessages(['weekly_hours' => 'Opening hours must start on a 15-minute interval and end later on the same day.']);
            }
        }
        $offStart = $timeOff === null ? null : $this->localInstant($timeOff->startsLocal, $timezone);
        try {
            $offEnd = $timeOff === null ? null : $this->localInstant($timeOff->endsLocal, $timezone);
        } catch (ValidationException $exception) {
            throw ValidationException::withMessages(['ends_local' => $exception->errors()['starts_local']]);
        }
        if ($offStart !== null && ! $offEnd->greaterThan($offStart)) {
            throw ValidationException::withMessages(['ends_local' => 'Time off must end after it starts.']);
        }
        $errors = [];
        foreach ($profile->bookings()->occupying($now)->where('ends_at', '>', $now->utc())->orderBy('starts_at')->get() as $booking) {
            if (! $this->fitsSchedule($schedule, $timezone, $booking->starts_at, $booking->ends_at) || ($offStart !== null && $booking->starts_at->lessThan($offEnd) && $booking->ends_at->greaterThan($offStart))) {
                $errors['booking.'.$booking->id] = 'Booking #'.$booking->id.' on '.$booking->starts_at->setTimezone($booking->timezone)->format('d M Y H:i').' '.$booking->timezone.' must remain available.';
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * @param  User  $actor
     * @param  WeeklySchedule  $schedule
     * @return void
     */
    public function saveWeekly(User $actor, WeeklySchedule $schedule): void
    {
        DB::connection('visitor')->transaction(function () use ($actor, $schedule): void {
            $profile = app(StylistService::class)->profile($actor);
            Gate::forUser($actor)->authorize('update', $profile);
            $profile->increment('booking_lock_version');
            $this->assertScheduleSafe($profile, $schedule, $profile->timezone, null, CarbonImmutable::now('UTC'));
            $profile->workingHours()->delete();
            foreach ($schedule->intervals as $interval) {
                $profile->workingHours()->create(['weekday' => $interval->weekday, 'opens_at' => $interval->opensAt, 'closes_at' => $interval->closesAt]);
            }
        });
    }

    /**
     * @param  User  $actor
     * @param  TimeOffInput  $input
     * @return TimeOff
     */
    public function addTimeOff(User $actor, TimeOffInput $input): TimeOff
    {
        return DB::connection('visitor')->transaction(function () use ($actor, $input): TimeOff {
            $profile = app(StylistService::class)->profile($actor);
            Gate::forUser($actor)->authorize('update', $profile);
            $profile->increment('booking_lock_version');
            $this->assertScheduleSafe($profile, $this->currentSchedule($profile), $profile->timezone, $input, CarbonImmutable::now('UTC'));

            return $profile->timeOff()->create(['starts_at' => $this->localInstant($input->startsLocal, $profile->timezone), 'ends_at' => $this->localInstant($input->endsLocal, $profile->timezone)]);
        });
    }

    /**
     * @param  User  $actor
     * @param  TimeOff  $timeOff
     * @return void
     */
    public function removeTimeOff(User $actor, TimeOff $timeOff): void
    {
        DB::connection('visitor')->transaction(function () use ($actor, $timeOff): void {
            Gate::forUser($actor)->authorize('delete', $timeOff);
            $timeOff->profile->increment('booking_lock_version');
            $timeOff->delete();
        });
    }
}
