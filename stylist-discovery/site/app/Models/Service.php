<?php

namespace App\Models;

use App\Data\DiscoveryFilter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Service extends Model
{
    protected $connection = 'visitor';

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'price_cents' => 'integer',
            'duration_minutes' => 'integer',
            'active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<StylistProfile, $this>
     */
    public function profile(): BelongsTo
    {
        return $this->belongsTo(StylistProfile::class, 'profile_id');
    }

    /**
     * @return BelongsTo<Specialty, $this>
     */
    public function specialty(): BelongsTo
    {
        return $this->belongsTo(Specialty::class, 'specialty_id');
    }

    /**
     * @return HasMany<Booking, $this>
     */
    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class, 'service_id');
    }

    /**
     * @param  Builder<static>  $query
     * @param  int  $ownerId
     * @return Builder<static>
     */
    public function scopeOwnedBy(Builder $query, int $ownerId): Builder
    {
        return $query->where('profile_id', $ownerId);
    }

    /**
     * @param  Builder<static>  $query
     * @param  DiscoveryFilter  $filter
     * @return Builder<static>
     */
    public function scopeMatching(Builder $query, DiscoveryFilter $filter): Builder
    {
        return $query->eligible()
            ->when($filter->specialtyId !== null, fn (Builder $services): Builder => $services->where('specialty_id', $filter->specialtyId))
            ->when($filter->minimumCents !== null, fn (Builder $services): Builder => $services->where('price_cents', '>=', $filter->minimumCents))
            ->when($filter->maximumCents !== null, fn (Builder $services): Builder => $services->where('price_cents', '<=', $filter->maximumCents));
    }

    /**
     * @param  Builder<static>  $query
     * @return Builder<static>
     */
    public function scopeEligible(Builder $query): Builder
    {
        return $query->where('active', true)
            ->whereHas('specialty', fn (Builder $specialties): Builder => $specialties->where('enabled', true));
    }
}
