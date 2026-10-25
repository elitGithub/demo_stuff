<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SandboxMeta extends Model
{
    protected $connection = 'visitor';

    protected $guarded = [];

    protected $table = 'sandbox_meta';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'access_lock_version' => 'integer',
            'seed_anchor' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
