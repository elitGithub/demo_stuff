<?php

namespace App\Models\Registry;

use App\Enums\SandboxStatus;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Sandbox extends Model
{
    protected $connection = 'registry';

    protected $guarded = [];

    protected $primaryKey = 'digest';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => SandboxStatus::class,
            'expires_at' => 'immutable_datetime',
            'allocated_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<SandboxFile, $this>
     */
    public function files(): HasMany
    {
        return $this->hasMany(SandboxFile::class, 'sandbox_digest', 'digest');
    }
}
