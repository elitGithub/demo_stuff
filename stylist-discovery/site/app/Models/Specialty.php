<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Specialty extends Model
{
    protected $connection = 'visitor';

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsToMany<StylistProfile, $this>
     */
    public function profiles(): BelongsToMany
    {
        return $this->belongsToMany(StylistProfile::class, 'profile_specialty', 'specialty_id', 'profile_id');
    }

    /**
     * @return HasMany<Service, $this>
     */
    public function services(): HasMany
    {
        return $this->hasMany(Service::class, 'specialty_id');
    }
}
