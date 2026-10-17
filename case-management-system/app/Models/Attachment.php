<?php

namespace App\Models;

use Database\Factories\AttachmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['case_message_id', 'filename', 'mime_type', 'size_bytes', 'storage_path'])]
class Attachment extends Model
{
    /** @use HasFactory<AttachmentFactory> */
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
     * @return BelongsTo<CaseMessage, $this>
     */
    public function caseMessage(): BelongsTo
    {
        return $this->belongsTo(CaseMessage::class, 'case_message_id');
    }
}
