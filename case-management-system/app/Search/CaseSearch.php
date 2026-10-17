<?php

namespace App\Search;

use App\Data\SearchFilters;
use App\Models\CaseRecord;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\LengthAwarePaginator;

final readonly class CaseSearch
{
    /**
     * @param  SearchFilters  $filters
     */
    public function __construct(public SearchFilters $filters) {}

    /**
     * @param  int  $perPage
     * @return LengthAwarePaginator<int, CaseRecord>
     */
    public function paginate(int $perPage = 25): LengthAwarePaginator
    {
        $query = CaseRecord::query()->with('latestMessage')->withCount('attachments');

        if ($this->filters->text !== null) {
            $pattern = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $this->filters->text).'%';
            $query->where(function (Builder $textQuery) use ($pattern): void {
                $textQuery->whereRaw("number LIKE ? ESCAPE '\\'", [$pattern])
                    ->orWhereRaw("subject LIKE ? ESCAPE '\\'", [$pattern])
                    ->orWhereRaw("issue LIKE ? ESCAPE '\\'", [$pattern])
                    ->orWhereRaw("notes LIKE ? ESCAPE '\\'", [$pattern])
                    ->orWhereHas('messages', fn (Builder $messages): Builder => $messages->whereRaw("body_text LIKE ? ESCAPE '\\'", [$pattern]));
            });
        }

        if ($this->filters->statuses !== []) {
            $query->whereIn('status', $this->filters->statuses);
        }

        if ($this->filters->trackedSenderId !== null) {
            $query->where('tracked_sender_id', $this->filters->trackedSenderId);
        }

        if ($this->filters->from !== null) {
            $query->where('received_at', '>=', $this->filters->from);
        }

        if ($this->filters->to !== null) {
            $query->where('received_at', '<=', $this->filters->to->endOfDay()->format('Y-m-d H:i:s.u'));
        }

        return $query->orderByDesc('received_at')->orderByDesc('id')->paginate($perPage)->appends($this->filters->parameters());
    }
}
