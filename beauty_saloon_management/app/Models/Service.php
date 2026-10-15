<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Service extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['active' => 'boolean', 'price' => 'integer', 'duration' => 'integer'];
    }

    public function stylists(): BelongsToMany
    {
        return $this->belongsToMany(Stylist::class);
    }
}
