<?php

namespace App\Models;

use App\Enums\ProfileStatus;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class StylistProfile extends Model
{
    protected $connection = 'visitor';

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => ProfileStatus::class,
            'deposit_percent' => 'integer',
            'booking_lock_version' => 'integer',
            'starting_price_cents' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /**
     * @return BelongsToMany<Specialty, $this>
     */
    public function specialties(): BelongsToMany
    {
        return $this->belongsToMany(Specialty::class, 'profile_specialty', 'profile_id', 'specialty_id');
    }

    /**
     * @return HasMany<Service, $this>
     */
    public function services(): HasMany
    {
        return $this->hasMany(Service::class, 'profile_id');
    }

    /**
     * @return HasMany<PortfolioImage, $this>
     */
    public function portfolioImages(): HasMany
    {
        return $this->hasMany(PortfolioImage::class, 'profile_id');
    }

    /**
     * @return HasMany<WorkingHours, $this>
     */
    public function workingHours(): HasMany
    {
        return $this->hasMany(WorkingHours::class, 'profile_id');
    }

    /**
     * @return HasMany<TimeOff, $this>
     */
    public function timeOff(): HasMany
    {
        return $this->hasMany(TimeOff::class, 'profile_id');
    }

    /**
     * @return HasMany<Booking, $this>
     */
    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class, 'profile_id');
    }

    /**
     * @param  Builder<static>  $query
     * @param  int  $ownerId
     * @return Builder<static>
     */
    public function scopeOwnedBy(Builder $query, int $ownerId): Builder
    {
        return $query->where('user_id', $ownerId);
    }

    /**
     * @return bool
     */
    public function isPublished(): bool
    {
        return $this->status === ProfileStatus::Published;
    }

    /**
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeDiscoverable(Builder $query): Builder
    {
        return $query->where('status', ProfileStatus::Published);
    }
}
