<?php

namespace App\Models;

use App\Enums\CaseStatus;
use Database\Factories\CaseRecordFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable([
    'number',
    'status',
    'issue',
    'notes',
    'tracked_sender_id',
    'sender_email',
    'sender_name',
    'subject',
    'thread_id',
    'received_at',
    'closed_at',
])]
class CaseRecord extends Model
{
    /** @use HasFactory<CaseRecordFactory> */
    use HasFactory;

    protected $table = 'cases';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'status' => CaseStatus::class,
            'received_at' => 'immutable_datetime',
            'closed_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<TrackedSender, $this>
     */
    public function trackedSender(): BelongsTo
    {
        return $this->belongsTo(TrackedSender::class, 'tracked_sender_id');
    }

    /**
     * @return HasMany<CaseMessage, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(CaseMessage::class, 'case_id')->orderBy('sent_at')->orderBy('id');
    }

    /**
     * @return HasMany<CaseEvent, $this>
     */
    public function events(): HasMany
    {
        return $this->hasMany(CaseEvent::class, 'case_id')->orderBy('occurred_at')->orderBy('id');
    }

    /**
     * @return HasManyThrough<Attachment, CaseMessage, $this>
     */
    public function attachments(): HasManyThrough
    {
        return $this->hasManyThrough(Attachment::class, CaseMessage::class, 'case_id', 'case_message_id');
    }

    /**
     * @return HasOne<CaseMessage, $this>
     */
    public function latestMessage(): HasOne
    {
        return $this->hasOne(CaseMessage::class, 'case_id')->latestOfMany('sent_at');
    }
}
