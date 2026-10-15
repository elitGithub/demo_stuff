<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

class Subscriber extends Model
{
    protected $guarded = [];

    protected $hidden = ['unsubscribe_token'];

    protected function casts(): array
    {
        return ['consented_at' => 'immutable_datetime', 'unsubscribed_at' => 'immutable_datetime'];
    }

    protected static function booted(): void
    {
        static::creating(function (Subscriber $subscriber) {
            $subscriber->email = Str::lower(trim($subscriber->email));
            $subscriber->unsubscribe_token ??= Str::random(64);
        });
    }
}
