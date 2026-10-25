<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class WorkingHours extends Model
{
    protected $connection = 'visitor';

    protected $guarded = [];

    protected $table = 'working_hours';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'weekday' => 'integer',
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
     * @param  Builder<static>  $query
     * @param  int  $ownerId
     * @return Builder<static>
     */
    public function scopeOwnedBy(Builder $query, int $ownerId): Builder
    {
        return $query->where('profile_id', $ownerId);
    }
}
