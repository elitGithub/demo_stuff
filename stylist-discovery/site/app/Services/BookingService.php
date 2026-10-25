<?php

namespace App\Services;

use App\Data\BookingInput;
use App\Data\BookingReview;
use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Enums\InboxEvent;
use App\Exceptions\BookingConflictException;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\Service;
use App\Models\StylistProfile;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class BookingService
{
    /** @param User $actor
     * @param ?BookingStatus $status
     * @param ?string $localDate
     * @param int $page
     * @param CarbonImmutable $now
     * @return LengthAwarePaginator<Booking> */
    public function forActor(User $actor, ?BookingStatus $status, ?string $localDate, int $page, CarbonImmutable $now): LengthAwarePaginator
    {
        $this->expireForActor($actor, $now);
        $query = Booking::query()->forActor($actor)->with(['profile.user', 'client']);
        if ($status !== null) {
            $query->where('status', $status);
        }
        if ($localDate !== null) {
            $query->where(function (Builder $dates) use ($localDate): void {
                foreach (collect(config('demo.locations'))->pluck('timezone')->unique() as $timezone) {
                    $start = CarbonImmutable::parse($localDate, $timezone)->startOfDay();
                    $dates->orWhere(fn (Builder $date) => $date->where('timezone', $timezone)->where('starts_at', '>=', $start->utc())->where('starts_at', '<', $start->addDay()->utc()));
                }
            });
        }

        return $query->orderByRaw('CASE WHEN status IN (?, ?, ?) AND ends_at > ? THEN 0 ELSE 1 END', [BookingStatus::Requested->value, BookingStatus::AwaitingDeposit->value, BookingStatus::Confirmed->value, $now->utc()])
            ->orderByRaw('CASE WHEN status IN (?, ?, ?) AND ends_at > ? THEN starts_at END ASC', [BookingStatus::Requested->value, BookingStatus::AwaitingDeposit->value, BookingStatus::Confirmed->value, $now->utc()])
            ->orderByDesc('starts_at')->orderByDesc('id')->paginate(config('demo.pagination'), ['*'], 'page', $page);
    }

    /** @param User $actor
     * @param BookingStatus $status
     * @param CarbonImmutable $now
     * @return int */
    public function countForActor(User $actor, BookingStatus $status, CarbonImmutable $now): int
    {
        $this->expireForActor($actor, $now);

        return Booking::query()->forActor($actor)->where('status', $status)->count();
    }

    /** @param User $actor
     * @param Booking $booking
     * @param ?string $reason
     * @param CarbonImmutable $now
     * @return Booking */
    public function cancel(User $actor, Booking $booking, ?string $reason, CarbonImmutable $now): Booking
    {
        Gate::forUser($actor)->authorize('cancel', $booking);

        return DB::connection('visitor')->transaction(function () use ($actor, $booking, $reason, $now): Booking {
            $booking->profile->increment('booking_lock_version');
            $this->expireFor($booking->profile, $now);
            $booking->refresh();
            if ($booking->status === BookingStatus::Cancelled) {
                return $booking;
            }
            abort_unless($now->lessThan($booking->starts_at) && in_array($booking->status, $actor->hasRole(AccountRole::Client) ? [BookingStatus::Requested, BookingStatus::AwaitingDeposit, BookingStatus::Confirmed] : [BookingStatus::AwaitingDeposit, BookingStatus::Confirmed], true), 409, 'Only upcoming requests or confirmed appointments can be cancelled from this perspective.');
            $refunded = $booking->status === BookingStatus::Confirmed;
            if ($refunded) {
                app(PaymentService::class)->refund($booking);
            }
            $booking->update(['status' => BookingStatus::Cancelled, 'cancellation_reason' => $reason]);
            foreach ([$booking->client, $booking->profile->user] as $recipient) {
                app(InboxService::class)->record($booking, $recipient, InboxEvent::BookingCancelled);
                if ($refunded) {
                    app(InboxService::class)->record($booking, $recipient, InboxEvent::DepositRefunded);
                }
            }
            $booking->update(['notification_budget' => 0]);

            return $booking->refresh();
        });
    }

    /** @param User $actor
     * @param Booking $booking
     * @param CarbonImmutable $now
     * @return Booking */
    public function complete(User $actor, Booking $booking, CarbonImmutable $now): Booking
    {
        Gate::forUser($actor)->authorize('decide', $booking);

        return DB::connection('visitor')->transaction(function () use ($booking, $now): Booking {
            $booking->profile->increment('booking_lock_version');
            $booking->refresh();
            if ($booking->status === BookingStatus::Completed) {
                return $booking;
            }
            abort_unless($booking->status === BookingStatus::Confirmed && $now->greaterThanOrEqualTo($booking->ends_at), 409, 'An appointment can be completed only after its end time.');
            $booking->update(['status' => BookingStatus::Completed, 'notification_budget' => 0]);

            return $booking;
        });
    }

    /**
     * @param  int  $serviceId
     * @param  string  $startsLocal
     * @param  CarbonImmutable  $now
     * @return BookingReview
     */
    public function review(int $serviceId, string $startsLocal, CarbonImmutable $now): BookingReview
    {
        $service = Service::query()->eligible()->with('profile')->findOrFail($serviceId);
        $profile = $service->profile;
        abort_unless($profile->isPublished() && $profile->specialties()->whereKey($service->specialty_id)->exists(), 404);
        $availability = app(AvailabilityService::class);
        $startsAt = $availability->localInstant($startsLocal, $profile->timezone);
        $availability->assertAvailable($profile, $startsAt, $startsAt->addMinutes($service->duration_minutes), null, $now);
        abort_if($startsAt->lessThan($now->utc()->addHours(config('demo.booking.lead_hours'))) || $startsAt->greaterThan($now->utc()->addDays(config('demo.booking.horizon_days'))), 409, 'This time is outside the request window.');

        return new BookingReview(service: $service, profile: $profile, startsAt: $startsAt, requestKey: (string) Str::uuid(), depositCents: intdiv($service->price_cents * $profile->deposit_percent + 50, 100));
    }

    /**
     * @param  User  $actor
     * @param  CarbonImmutable  $now
     * @return void
     */
    public function expireForActor(User $actor, CarbonImmutable $now): void
    {
        $profiles = StylistProfile::query()->where(function ($query) use ($actor): void {
            if ($actor->hasRole(AccountRole::Stylist)) {
                $query->where('user_id', $actor->id);
            } elseif ($actor->hasRole(AccountRole::Client)) {
                $query->whereHas('bookings', fn ($booking) => $booking->where('client_id', $actor->id));
            } else {
                $query->whereRaw('1 = 0');
            }
        })->orderBy('id')->limit(config('demo.limits.profiles'))->get();
        foreach ($profiles as $profile) {
            $this->expireFor($profile, $now);
        }
    }

    /**
     * @param  User  $actor
     * @param  int  $page
     * @return LengthAwarePaginator<Booking>
     */
    public function appointments(User $actor, int $page): LengthAwarePaginator
    {
        return Booking::query()->where(function ($query) use ($actor): void {
            if ($actor->hasRole(AccountRole::Client)) {
                $query->where('client_id', $actor->id);
            } elseif ($actor->hasRole(AccountRole::Stylist)) {
                $query->whereHas('profile', fn ($profile) => $profile->where('user_id', $actor->id));
            } else {
                $query->whereRaw('1 = 0');
            }
        })->with('profile')->orderByDesc('id')->paginate(config('demo.pagination'), ['*'], 'appointments_page', $page);
    }

    /**
     * @param  User  $actor
     * @param  int  $bookingId
     * @return Booking
     */
    public function visibleTo(User $actor, int $bookingId): Booking
    {
        $booking = Booking::query()->with(['profile.user', 'client'])->findOrFail($bookingId);
        abort_unless(Gate::forUser($actor)->allows('view', $booking), 404);

        return $booking;
    }

    /**
     * @param  User  $actor
     * @param  BookingInput  $input
     * @param  CarbonImmutable  $now
     * @return Booking
     */
    public function request(User $actor, BookingInput $input, CarbonImmutable $now): Booking
    {
        abort_unless($actor->hasRole(AccountRole::Client), 403);

        return DB::connection('visitor')->transaction(function () use ($actor, $input, $now): Booking {
            $service = Service::query()->findOrFail($input->serviceId);
            $profile = $service->profile;
            $profile->increment('booking_lock_version');
            $profile->refresh();
            $fingerprint = hash('sha256', json_encode([$input->serviceId, $input->startsLocal, $input->note], JSON_THROW_ON_ERROR));
            $previous = Booking::query()->ownedBy($actor->id)->where('request_key', $input->requestKey)->first();
            if ($previous !== null) {
                if (! hash_equals($previous->input_fingerprint, $fingerprint)) {
                    throw new BookingConflictException(message: 'This request belongs to an existing appointment. Open it to continue.', booking: $previous);
                }

                return $previous;
            }
            $this->expireFor($profile, $now);
            $service->refresh();
            abort_unless($profile->isPublished() && Service::query()->eligible()->whereKey($service->id)->exists() && $profile->specialties()->whereKey($service->specialty_id)->exists(), 409, 'This service is no longer available. Choose another service.');
            $availability = app(AvailabilityService::class);
            $start = $availability->localInstant($input->startsLocal, $profile->timezone);
            if ($start->lessThan($now->utc()->addHours(config('demo.booking.lead_hours'))) || $start->greaterThan($now->utc()->addDays(config('demo.booking.horizon_days')))) {
                throw ValidationException::withMessages(['starts_local' => 'Choose a time at least two hours ahead and within the next 60 days.']);
            }
            $duplicate = Booking::query()->ownedBy($actor->id)->where('service_id', $service->id)->where('starts_at', $start)->whereIn('status', [BookingStatus::Requested, BookingStatus::AwaitingDeposit, BookingStatus::Confirmed])->first();
            if ($duplicate !== null) {
                throw new BookingConflictException(message: 'You already have an active request for this appointment.', booking: $duplicate);
            }
            $availability->assertAvailable($profile, $start, $start->addMinutes($service->duration_minutes), null, $now);
            $budget = config('demo.booking.notification_budget');
            abort_if(Booking::query()->count() >= config('demo.limits.bookings') || InboxMessage::query()->count() + Booking::query()->sum('notification_budget') + $budget > config('demo.limits.messages'), 429, 'This demo has reached its booking capacity.');
            $deposit = intdiv($service->price_cents * $profile->deposit_percent + 50, 100);
            $booking = Booking::query()->create(['client_id' => $actor->id, 'profile_id' => $profile->id, 'service_id' => $service->id, 'request_key' => $input->requestKey, 'input_fingerprint' => $fingerprint, 'service_name' => $service->name, 'price_cents' => $service->price_cents, 'duration_minutes' => $service->duration_minutes, 'deposit_percent' => $profile->deposit_percent, 'deposit_cents' => $deposit, 'remaining_cents' => $service->price_cents - $deposit, 'currency' => config('demo.currency'), 'timezone' => $profile->timezone, 'starts_at' => $start, 'ends_at' => $start->addMinutes($service->duration_minutes), 'note' => $input->note, 'status' => BookingStatus::Requested, 'notification_budget' => $budget]);
            app(InboxService::class)->record($booking, $profile->user, InboxEvent::RequestReceived);

            return $booking->refresh();
        });
    }

    /**
     * @param  User  $actor
     * @param  Booking  $booking
     * @param  CarbonImmutable  $now
     * @return Booking
     */
    public function accept(User $actor, Booking $booking, CarbonImmutable $now): Booking
    {
        Gate::forUser($actor)->authorize('decide', $booking);

        return DB::connection('visitor')->transaction(function () use ($booking, $now): Booking {
            $profile = $booking->profile;
            $profile->increment('booking_lock_version');
            $profile->refresh();
            $this->expireFor($profile, $now);
            $booking->refresh();
            if (in_array($booking->status, [BookingStatus::AwaitingDeposit, BookingStatus::Expired], true)) {
                return $booking;
            }
            abort_unless($booking->status === BookingStatus::Requested, 409, 'This request has already been decided.');
            abort_unless($profile->isPublished() && Service::query()->eligible()->whereKey($booking->service_id)->exists() && $profile->specialties()->whereKey($booking->service->specialty_id)->exists(), 409, 'The studio or service is unavailable. Restore availability or decline this request.');
            try {
                app(AvailabilityService::class)->assertAvailable($profile, $booking->starts_at, $booking->ends_at, $booking->id, $now);
            } catch (ValidationException) {
                abort(409, 'This appointment conflicts with the current studio schedule. Decline it or resolve the conflict.');
            }
            $booking->update(['status' => BookingStatus::AwaitingDeposit, 'accepted_at' => $now->utc(), 'deposit_deadline' => $now->utc()->addMinutes(config('demo.booking.hold_minutes'))->min($booking->starts_at)]);
            app(InboxService::class)->record($booking, $booking->client, InboxEvent::RequestAccepted);

            return $booking->refresh();
        });
    }

    /**
     * @param  User  $actor
     * @param  Booking  $booking
     * @param  ?string  $reason
     * @param  CarbonImmutable  $now
     * @return Booking
     */
    public function decline(User $actor, Booking $booking, ?string $reason, CarbonImmutable $now): Booking
    {
        Gate::forUser($actor)->authorize('decide', $booking);

        return DB::connection('visitor')->transaction(function () use ($booking, $reason, $now): Booking {
            $booking->profile->increment('booking_lock_version');
            $this->expireFor($booking->profile, $now);
            $booking->refresh();
            if (in_array($booking->status, [BookingStatus::Declined, BookingStatus::Expired], true)) {
                return $booking;
            }
            abort_unless($booking->status === BookingStatus::Requested, 409, 'This request has already been decided.');
            $booking->update(['status' => BookingStatus::Declined, 'decline_reason' => $reason]);
            app(InboxService::class)->record($booking, $booking->client, InboxEvent::RequestDeclined);
            $booking->update(['notification_budget' => 0]);

            return $booking;
        });
    }

    /**
     * @param  StylistProfile  $profile
     * @param  CarbonImmutable  $now
     * @return int
     */
    public function expireFor(StylistProfile $profile, CarbonImmutable $now): int
    {
        return DB::connection('visitor')->transaction(function () use ($profile, $now): int {
            $profile->increment('booking_lock_version');
            $expired = $profile->bookings()->where(function ($query) use ($now): void {
                $query->where(fn ($requested) => $requested->where('status', BookingStatus::Requested)->where('starts_at', '<=', $now->utc()))->orWhere(fn ($held) => $held->where('status', BookingStatus::AwaitingDeposit)->where(fn ($deadline) => $deadline->where('deposit_deadline', '<=', $now->utc())->orWhere('starts_at', '<=', $now->utc())));
            })->orderByRaw('COALESCE(deposit_deadline, starts_at)')->limit(config('demo.limits.bookings'))->get();
            foreach ($expired as $booking) {
                $booking->update(['status' => BookingStatus::Expired]);
                app(InboxService::class)->record($booking, $booking->client, InboxEvent::BookingExpired);
                app(InboxService::class)->record($booking, $profile->user, InboxEvent::BookingExpired);
                $booking->update(['notification_budget' => 0]);
            }

            return $expired->count();
        });
    }

    /**
     * @param  User  $actor
     * @param  Booking  $booking
     * @return ?AccountRole
     */
    public function handoffRole(User $actor, Booking $booking): ?AccountRole
    {
        if ($booking->client->email !== config('demo.seed_accounts.client') || ! $booking->client->hasRole(AccountRole::Client) || $booking->profile->user->email !== config('demo.seed_accounts.stylist') || ! $booking->profile->user->hasRole(AccountRole::Stylist)) {
            return null;
        }
        if ($actor->is($booking->client) && $actor->hasRole(AccountRole::Client)) {
            return AccountRole::Stylist;
        }
        if ($actor->is($booking->profile->user) && $actor->hasRole(AccountRole::Stylist)) {
            return AccountRole::Client;
        }

        return null;
    }
}
