<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AppointmentItem extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['price' => 'integer', 'duration' => 'integer'];
    }

    public $timestamps = false;

    public function service(): BelongsTo
    {
        return $this->belongsTo(Service::class);
    }
}
