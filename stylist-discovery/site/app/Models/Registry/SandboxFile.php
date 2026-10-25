<?php

namespace App\Models\Registry;

use App\Enums\UploadStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SandboxFile extends Model
{
    protected $connection = 'registry';

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => UploadStatus::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Sandbox, $this>
     */
    public function sandbox(): BelongsTo
    {
        return $this->belongsTo(Sandbox::class, 'sandbox_digest', 'digest');
    }
}
