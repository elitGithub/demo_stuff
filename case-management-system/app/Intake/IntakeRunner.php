<?php

namespace App\Intake;

use App\Contracts\MailboxConnector;
use App\Data\IntakeOutcome;
use App\Enums\IntakeResult;
use App\Models\InstallationMeta;
use Illuminate\Support\Facades\DB;
use Throwable;

final class IntakeRunner
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
     * @return list<IntakeOutcome>
     *
     * @throws Throwable
     */
    public function run(): array
    {
        return DB::transaction(function (): array {
            $meta = InstallationMeta::query()->lockForUpdate()->sole();
            $pull = $this->connector->pull($meta->mailbox_cursor);
            $outcomes = [];

            foreach ($pull->messages as $message) {
                $outcomes[] = $this->intake->ingest($message);
            }

            foreach ($pull->rejected as $rejected) {
                $outcomes[] = new IntakeOutcome(result: IntakeResult::Ignored, case: null, message: null, reason: $rejected->reason, gmailMessageId: $rejected->gmailMessageId);
            }

            $meta->fill(['mailbox_cursor' => $pull->cursor])->save();

            return $outcomes;
        });
    }
}
