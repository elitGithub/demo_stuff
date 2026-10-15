<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MarketingMessage extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['due_date' => 'immutable_date', 'processed_at' => 'immutable_datetime', 'attempts' => 'integer'];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function subscriber(): BelongsTo
    {
        return $this->belongsTo(Subscriber::class);
    }
}
