<?php

namespace App\Actions\Senders;

use App\Intake\TrackedSenderBackfill;
use App\Models\TrackedSender;
use Illuminate\Support\Facades\DB;

final class ReactivateTrackedSender
{
    /**
     * @param  TrackedSenderBackfill  $backfill
     */
    public function __construct(private readonly TrackedSenderBackfill $backfill) {}

    /**
     * @param  TrackedSender  $sender
     * @return TrackedSender
     */
    public function __invoke(TrackedSender $sender): TrackedSender
    {
        return DB::transaction(function () use ($sender): TrackedSender {
            $sender->refresh()->fill(['is_active' => true])->save();
            $this->backfill->run($sender);

            return $sender;
        });
    }
}
