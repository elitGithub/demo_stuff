<?php

namespace App\Models;

use Database\Factories\TrackedSenderFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['email', 'name', 'label', 'is_active'])]
class TrackedSender extends Model
{
    /** @use HasFactory<TrackedSenderFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return HasMany<CaseRecord, $this>
     */
    public function cases(): HasMany
    {
        return $this->hasMany(CaseRecord::class, 'tracked_sender_id');
    }
}
