<?php

namespace App\Policies;

use App\Models\InboxMessage;
use App\Models\User;

class InboxMessagePolicy
{
    /**
     * @param  User  $user
     * @param  InboxMessage  $inboxMessage
     * @return bool
     */
    public function update(User $user, InboxMessage $inboxMessage): bool
    {
        return $user->id === $inboxMessage->recipient_id;
    }
}
