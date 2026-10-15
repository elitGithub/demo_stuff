<?php

namespace App\Models;

use Database\Factories\OpportunityFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Opportunity extends Model
{
    /** @use HasFactory<OpportunityFactory> */
    use HasFactory;

    public const STAGES = ['lead', 'engagement', 'proposal', 'order', 'payment', 'delivery', 'closed', 'cancelled'];

    public const KINDS = ['enquiry' => 'Enquiry', 'package' => 'Salon package', 'group_booking' => 'Group booking'];

    protected $guarded = [];

    protected function casts(): array
    {
        return ['event_date' => 'immutable_date', 'stage_entered_at' => 'immutable_datetime', 'next_follow_up_at' => 'immutable_datetime', 'stage_details' => 'array', 'guest_count' => 'integer'];
    }

    public function scopeVisibleTo(Builder $query, User $user): Builder
    {
        if (! $user->active) {
            return $query->whereRaw('1 = 0');
        }

        return $user->isManager() ? $query : $query->where('assigned_to', $user->id);
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function assignedUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(OpportunityEvent::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(OpportunityDocument::class);
    }

    public function isTerminal(): bool
    {
        return in_array($this->stage, ['closed', 'cancelled'], true);
    }

    public function nextStage(): ?string
    {
        return $this->isTerminal() ? null : self::STAGES[array_search($this->stage, self::STAGES, true) + 1];
    }
}
