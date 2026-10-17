<?php

namespace App\Actions\Senders;

use App\Exceptions\SenderHasCases;
use App\Models\TrackedSender;
use Illuminate\Support\Facades\DB;

final class DeleteTrackedSender
{
    /**
     * @param  TrackedSender  $sender
     * @return void
     *
     * @throws SenderHasCases
     */
    public function __invoke(TrackedSender $sender): void
    {
        DB::transaction(function () use ($sender): void {
            if ($sender->cases()->exists()) {
                throw new SenderHasCases;
            }

            $sender->delete();
        });
    }
}
