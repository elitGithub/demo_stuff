<?php

namespace App\Models;

use App\Enums\MessageDirection;
use Database\Factories\CaseMessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'case_id',
    'mailbox_message_id',
    'gmail_message_id',
    'thread_id',
    'direction',
    'from_email',
    'from_name',
    'to_email',
    'subject',
    'body_text',
    'sent_at',
])]
class CaseMessage extends Model
{
    /** @use HasFactory<CaseMessageFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'direction' => MessageDirection::class,
            'sent_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<CaseRecord, $this>
     */
    public function case(): BelongsTo
    {
        return $this->belongsTo(CaseRecord::class, 'case_id');
    }

    /**
     * @return HasMany<Attachment, $this>
     */
    public function attachments(): HasMany
    {
        return $this->hasMany(Attachment::class, 'case_message_id');
    }

    /**
     * @return BelongsTo<MailboxMessage, $this>
     */
    public function mailboxMessage(): BelongsTo
    {
        return $this->belongsTo(MailboxMessage::class, 'mailbox_message_id');
    }
}
