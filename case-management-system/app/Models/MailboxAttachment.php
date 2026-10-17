<?php

namespace App\Models;

use Database\Factories\MailboxAttachmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['mailbox_message_id', 'filename', 'mime_type', 'size_bytes', 'storage_path'])]
class MailboxAttachment extends Model
{
    /** @use HasFactory<MailboxAttachmentFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'size_bytes' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<MailboxMessage, $this>
     */
    public function mailboxMessage(): BelongsTo
    {
        return $this->belongsTo(MailboxMessage::class, 'mailbox_message_id');
    }
}
