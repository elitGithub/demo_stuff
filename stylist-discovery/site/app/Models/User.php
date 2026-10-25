<?php

namespace App\Models;

use App\Enums\AccountRole;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password', 'role'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    use Notifiable;

    protected $connection = 'visitor';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'role' => AccountRole::class,
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'email_verified_at' => 'immutable_datetime',
            'password' => 'hashed',
        ];
    }

    /**
     * @param  AccountRole  $role
     * @return bool
     */
    public function hasRole(AccountRole $role): bool
    {
        return $this->role === $role;
    }

    /**
     * @return HasOne<StylistProfile, $this>
     */
    public function profile(): HasOne
    {
        return $this->hasOne(StylistProfile::class, 'user_id');
    }

    /**
     * @return HasMany<Booking, $this>
     */
    public function bookings(): HasMany
    {
        return $this->hasMany(Booking::class, 'client_id');
    }

    /**
     * @return HasMany<InboxMessage, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(InboxMessage::class, 'recipient_id');
    }
}
