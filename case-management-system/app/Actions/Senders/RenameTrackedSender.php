<?php

namespace App\Actions\Senders;

use App\Models\TrackedSender;

final class RenameTrackedSender
{
    /**
     * @param  TrackedSender  $sender
     * @param  string  $name
     * @param  ?string  $label
     * @return TrackedSender
     */
    public function __invoke(TrackedSender $sender, string $name, ?string $label): TrackedSender
    {
        $sender->fill(['name' => $name, 'label' => $label])->save();

        return $sender;
    }
}
