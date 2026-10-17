<?php

namespace App\Queries;

use App\Enums\MailboxLabel;
use App\Models\MailboxMessage;
use Illuminate\Pagination\LengthAwarePaginator;

final readonly class MailboxListQuery
{
    /**
     * @param  ?MailboxLabel  $label
     */
    public function __construct(private ?MailboxLabel $label) {}

    /**
     * @param  int  $perPage
     * @return LengthAwarePaginator<int, MailboxMessage>
     */
    public function paginate(int $perPage = 50): LengthAwarePaginator
    {
        return MailboxMessage::query()
            ->when($this->label !== null, fn ($query) => $query->where('label', $this->label))
            ->with(['sender', 'caseMessage.case.trackedSender'])
            ->withCount('attachments')
            ->orderByDesc('received_at')->orderByDesc('id')
            ->paginate(min(50, max(1, $perPage)));
    }
}
