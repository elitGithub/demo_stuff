<?php

namespace App\Models;

use App\Enums\InboxEvent;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InboxMessage extends Model
{
    protected $connection = 'visitor';

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'event' => InboxEvent::class,
            'read_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }

    /**
     * @return BelongsTo<Booking, $this>
     */
    public function booking(): BelongsTo
    {
        return $this->belongsTo(Booking::class, 'booking_id');
    }

    /**
     * @param  Builder<static>  $query
     * @param  int  $ownerId
     * @return Builder<static>
     */
    public function scopeOwnedBy(Builder $query, int $ownerId): Builder
    {
        return $query->where('recipient_id', $ownerId);
    }
}
