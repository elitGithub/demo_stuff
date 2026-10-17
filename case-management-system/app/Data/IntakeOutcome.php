<?php

namespace App\Data;

use App\Enums\IntakeResult;
use App\Models\CaseMessage;
use App\Models\CaseRecord;

final readonly class IntakeOutcome
{
    /**
     * @param  IntakeResult  $result
     * @param  ?CaseRecord  $case
     * @param  ?CaseMessage  $message
     * @param  ?string  $reason
     * @param  ?string  $gmailMessageId
     */
    public function __construct(
        public IntakeResult $result,
        public ?CaseRecord $case,
        public ?CaseMessage $message,
        public ?string $reason = null,
        public ?string $gmailMessageId = null,
    ) {}
}
