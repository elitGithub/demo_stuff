<?php

namespace App\Intake;

use App\Contracts\MailboxConnector;
use App\Enums\IntakeResult;
use App\Models\TrackedSender;
use App\Support\SenderAddress;
use Illuminate\Support\Facades\DB;
use Throwable;

final class TrackedSenderBackfill
{
    /**
     * @param  MailboxConnector  $connector
     * @param  CaseIntake  $intake
     */
    public function __construct(
        private readonly MailboxConnector $connector,
        private readonly CaseIntake $intake,
    ) {}

    /**
     * @param  TrackedSender  $sender
     * @return int
     *
     * @throws Throwable
     */
    public function run(TrackedSender $sender): int
    {
        return DB::transaction(function () use ($sender): int {
            $sender->refresh();

            if (! $sender->is_active) {
                return 0;
            }

            $pull = $this->connector->backfill(new SenderAddress(email: $sender->email, name: $sender->name));
            $created = 0;

            foreach ($pull->messages as $message) {
                if ($this->intake->ingest($message)->result === IntakeResult::Created) {
                    $created++;
                }
            }

            return $created;
        });
    }
}
