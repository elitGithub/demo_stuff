<?php

namespace App\Queries;

use App\Models\TrackedSender;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Pagination\LengthAwarePaginator;

final class TrackedSenderListQuery
{
    private const int PER_PAGE = 25;

    /**
     * @return LengthAwarePaginator<int, TrackedSender>
     */
    public function paginate(): LengthAwarePaginator
    {
        return TrackedSender::query()->withCount('cases')->orderBy('name')->orderBy('id')->paginate(self::PER_PAGE);
    }

    /**
     * @param  TrackedSender  $sender
     * @return int
     */
    public function pageFor(TrackedSender $sender): int
    {
        $preceding = TrackedSender::query()->where(fn (Builder $query) => $query
            ->where('name', '<', $sender->name)
            ->orWhere(fn (Builder $ties) => $ties->where('name', $sender->name)->where('id', '<', $sender->id)))
            ->count();

        return intdiv($preceding, self::PER_PAGE) + 1;
    }
}
