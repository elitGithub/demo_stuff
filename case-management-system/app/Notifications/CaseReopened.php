<?php

namespace App\Notifications;

use App\Enums\IntakeResult;
use App\Models\CaseRecord;
use Illuminate\Notifications\Notification;

class CaseReopened extends Notification
{
    /**
     * @param  CaseRecord  $case
     */
    public function __construct(public readonly CaseRecord $case) {}

    /**
     * @param  object  $notifiable
     * @return array<int, string>
     */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    /**
     * @param  object  $notifiable
     * @return array{case_id: int, number: string, subject: string, result: string}
     */
    public function toArray(object $notifiable): array
    {
        return [
            'case_id' => $this->case->id,
            'number' => $this->case->number,
            'subject' => $this->case->subject,
            'result' => IntakeResult::Reopened->value,
        ];
    }
}
