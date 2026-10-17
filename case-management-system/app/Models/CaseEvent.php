<?php

namespace App\Models;

use App\Enums\CaseEventKind;
use App\Enums\CaseStatus;
use Database\Factories\CaseEventFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['case_id', 'kind', 'from_status', 'to_status', 'occurred_at'])]
class CaseEvent extends Model
{
    /** @use HasFactory<CaseEventFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'kind' => CaseEventKind::class,
            'from_status' => CaseStatus::class,
            'to_status' => CaseStatus::class,
            'occurred_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<CaseRecord, $this>
     */
    public function case(): BelongsTo
    {
        return $this->belongsTo(CaseRecord::class, 'case_id');
    }
}
