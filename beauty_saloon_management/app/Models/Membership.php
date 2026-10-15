<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Membership extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['starts_on' => 'immutable_date', 'ends_on' => 'immutable_date', 'price' => 'integer', 'duration_days' => 'integer'];
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(MembershipPlan::class, 'membership_plan_id');
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function previous(): BelongsTo
    {
        return $this->belongsTo(self::class, 'previous_membership_id');
    }

    public function renewal(): HasOne
    {
        return $this->hasOne(self::class, 'previous_membership_id');
    }

    public function status(): string
    {
        $today = now(config('studio.timezone'))->toDateString();

        return $today < $this->starts_on->toDateString() ? 'Upcoming' : ($today >= $this->ends_on->toDateString() ? 'Expired' : 'Active');
    }
}
