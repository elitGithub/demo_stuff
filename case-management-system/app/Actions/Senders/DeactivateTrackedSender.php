<?php

namespace App\Actions\Senders;

use App\Models\TrackedSender;

final class DeactivateTrackedSender
{
    /**
     * @param  TrackedSender  $sender
     * @return TrackedSender
     */
    public function __invoke(TrackedSender $sender): TrackedSender
    {
        $sender->fill(['is_active' => false])->save();

        return $sender;
    }
}
