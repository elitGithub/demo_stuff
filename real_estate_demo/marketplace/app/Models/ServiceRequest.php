<?php

namespace App\Models;

use App\Enums\JobStatus;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['customer_id', 'category_id', 'title', 'description', 'service_area', 'street_address', 'preferred_date', 'budget_cents', 'status', 'accepted_quote_id'])]
class ServiceRequest extends Model
{
    use HasFactory;

    protected function casts(): array
    {
        return [
            'preferred_date' => 'date',
            'budget_cents' => 'integer',
            'status' => JobStatus::class,
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'customer_id');
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function photos(): HasMany
    {
        return $this->hasMany(RequestPhoto::class);
    }

    public function quotes(): HasMany
    {
        return $this->hasMany(Quote::class);
    }

    public function acceptedQuote(): BelongsTo
    {
        return $this->belongsTo(Quote::class, 'accepted_quote_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(JobEvent::class);
    }

    public function review(): HasOne
    {
        return $this->hasOne(Review::class);
    }

    public function payment(): HasOne
    {
        return $this->hasOne(Payment::class);
    }
}
