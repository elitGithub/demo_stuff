<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    use HasFactory;

    protected $guarded = [];

    protected function casts(): array
    {
        return ['price' => 'integer', 'stock' => 'integer', 'active' => 'boolean'];
    }

    public function movements(): HasMany
    {
        return $this->hasMany(StockMovement::class);
    }
}
