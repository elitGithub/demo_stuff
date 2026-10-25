<?php

namespace App\Models\Registry;

use Illuminate\Database\Eloquent\Model;

class RevokedSession extends Model
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
            'expires_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
