<?php

namespace App\Models;

use App\Enums\MailboxLabel;
use Database\Factories\MailboxMessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable([
    'gmail_message_id',
    'thread_id',
    'label',
    'from_email',
    'from_name',
    'to_email',
    'subject',
    'body_text',
    'snippet',
    'is_notification',
    'received_at',
])]
class MailboxMessage extends Model
{
    /** @use HasFactory<MailboxMessageFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'label' => MailboxLabel::class,
            'is_notification' => 'boolean',
            'received_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<MailboxAttachment, $this>
     */
    public function attachments(): HasMany
    {
        return $this->hasMany(MailboxAttachment::class, 'mailbox_message_id');
    }

    /**
     * @return HasOne<CaseMessage, $this>
     */
    public function caseMessage(): HasOne
    {
        return $this->hasOne(CaseMessage::class, 'mailbox_message_id');
    }

    /**
     * @return BelongsTo<TrackedSender, $this>
     */
    public function sender(): BelongsTo
    {
        return $this->belongsTo(TrackedSender::class, 'from_email', 'email');
    }
}
