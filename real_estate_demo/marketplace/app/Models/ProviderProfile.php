<?php

namespace App\Models;

use App\Enums\ProviderStatus;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

#[Fillable(['user_id', 'business_name', 'slug', 'bio', 'service_areas', 'status'])]
class ProviderProfile extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return [
            'service_areas' => 'array',
            'status' => ProviderStatus::class,
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function categories(): BelongsToMany
    {
        return $this->belongsToMany(Category::class);
    }
}
