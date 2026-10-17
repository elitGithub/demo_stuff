<?php

namespace App\Models;

use App\Enums\ScriptEntryKind;
use Database\Factories\ScriptEntryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['kind', 'position', 'thread_id', 'payload', 'delivered_at'])]
class ScriptEntry extends Model
{
    /** @use HasFactory<ScriptEntryFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'kind' => ScriptEntryKind::class,
            'payload' => 'array',
            'delivered_at' => 'immutable_datetime',
        ];
    }
}
