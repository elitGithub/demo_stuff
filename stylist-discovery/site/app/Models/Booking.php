<?php

namespace App\Models;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Booking extends Model
{
    protected $connection = 'visitor';

    protected $guarded = [];

    /** @param Builder<static> $query
     * @param User $actor
     * @return Builder<static> */
    public function scopeForActor(Builder $query, User $actor): Builder
    {
        return match ($actor->role) {
            AccountRole::Client => $query->where('client_id', $actor->id),
            AccountRole::Stylist => $query->whereHas('profile', fn (Builder $profile) => $profile->where('user_id', $actor->id)),
            AccountRole::Admin => $query->whereRaw('1 = 0'),
        };
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => BookingStatus::class,
            'starts_at' => 'immutable_datetime',
            'ends_at' => 'immutable_datetime',
            'accepted_at' => 'immutable_datetime',
            'deposit_deadline' => 'immutable_datetime',
            'price_cents' => 'integer',
            'duration_minutes' => 'integer',
            'deposit_percent' => 'integer',
            'deposit_cents' => 'integer',
            'remaining_cents' => 'integer',
            'notification_budget' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function client(): BelongsTo
    {
        return $this->belongsTo(User::class, 'client_id');
    }

    /**
     * @return BelongsTo<StylistProfile, $this>
     */
    public function profile(): BelongsTo
    {
        return $this->belongsTo(StylistProfile::class, 'profile_id');
    }

    /**
     * @return BelongsTo<Service, $this>
     */
    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class, 'service_id');
    }

    /**
     * @return HasMany<Payment, $this>
     */
    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class, 'booking_id');
    }

    /**
     * @return HasMany<InboxMessage, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(InboxMessage::class, 'booking_id');
    }

    /**
     * @param  Builder<static>  $query
     * @param  int  $ownerId
     * @return Builder<static>
     */
    public function scopeOwnedBy(Builder $query, int $ownerId): Builder
    {
        return $query->where('client_id', $ownerId);
    }

    /**
     * @param  Builder<static>  $query
     * @param  CarbonImmutable  $now
     * @return Builder<static>
     */
    public function scopeOccupying(Builder $query, CarbonImmutable $now): Builder
    {
        return $query->where(function (Builder $occupied) use ($now): void {
            $occupied->where('status', BookingStatus::Confirmed)->orWhere(function (Builder $holds) use ($now): void {
                $holds->where('status', BookingStatus::AwaitingDeposit)->where('deposit_deadline', '>', $now->utc())->where('starts_at', '>', $now->utc());
            });
        });
    }

    /**
     * @param  CarbonImmutable  $now
     * @return BookingStatus
     */
    public function effectiveStatus(CarbonImmutable $now): BookingStatus
    {
        if ($this->status === BookingStatus::Requested && $now->greaterThanOrEqualTo($this->starts_at)) {
            return BookingStatus::Expired;
        }

        if ($this->status === BookingStatus::AwaitingDeposit && ($now->greaterThanOrEqualTo($this->starts_at) || $now->greaterThanOrEqualTo($this->deposit_deadline))) {
            return BookingStatus::Expired;
        }

        return $this->status;
    }

    /**
     * @param  CarbonImmutable  $now
     * @return bool
     */
    public function isPayable(CarbonImmutable $now): bool
    {
        return $this->effectiveStatus($now) === BookingStatus::AwaitingDeposit;
    }
}
