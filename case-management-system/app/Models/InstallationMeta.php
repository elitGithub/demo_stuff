<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['schema_version', 'seeded_at', 'dates_shifted_to', 'mailbox_cursor'])]
class InstallationMeta extends Model
{
    protected $table = 'installation_meta';

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'seeded_at' => 'immutable_datetime',
            'dates_shifted_to' => 'immutable_datetime',
        ];
    }
}
