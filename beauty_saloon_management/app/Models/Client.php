<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Client extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['birthday' => 'immutable_date', 'anniversary' => 'immutable_date', 'marketing_channels' => 'array', 'channels' => 'array', 'preferred_services' => 'array', 'maintenance_weeks' => 'integer'];
    }

    public function appointments(): HasMany
    {
        return $this->hasMany(Appointment::class);
    }

    public function invoices(): HasMany
    {
        return $this->hasMany(Invoice::class);
    }

    public function notes(): HasMany
    {
        return $this->hasMany(ClientNote::class)->latest();
    }

    public function followUps(): HasMany
    {
        return $this->hasMany(FollowUp::class);
    }

    public function preferredStylist(): BelongsTo
    {
        return $this->belongsTo(Stylist::class, 'preferred_stylist_id');
    }

    public function initials(): string
    {
        return collect(explode(' ', $this->name))->filter()->take(2)->map(fn ($part) => mb_substr($part, 0, 1))->implode('');
    }
}
