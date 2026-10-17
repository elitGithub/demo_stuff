<?php

namespace App\View\Components;

use App\Enums\CaseEventKind;
use App\Enums\CasefileMode;
use App\Models\CaseEvent;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use Illuminate\Contracts\View\View;
use Illuminate\Support\Collection;
use Illuminate\View\Component;
use ValueError;

class CaseThread extends Component
{
    private const array SHOWN_EVENTS = [CaseEventKind::StatusChanged, CaseEventKind::Reopened];

    /**
     * @var Collection<int, CaseMessage|CaseEvent>
     */
    public Collection $entries;

    public bool $simulated;

    /**
     * @param  CaseRecord  $case
     *
     * @throws ValueError
     */
    public function __construct(
        public CaseRecord $case,
    ) {
        $this->entries = $case->messages
            ->toBase()
            ->concat($case->events->whereIn('kind', self::SHOWN_EVENTS))
            ->sortBy(fn (CaseMessage|CaseEvent $entry): array => $entry instanceof CaseMessage
                ? [$entry->sent_at->getTimestamp(), 0, $entry->id]
                : [$entry->occurred_at->getTimestamp(), 1, $entry->id])
            ->values();
        $this->simulated = CasefileMode::current()->demoControlsEnabled();
    }

    /**
     * @return View
     */
    public function render(): View
    {
        return view('components.case-thread');
    }
}
