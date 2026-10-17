<?php

namespace App\Queries;

use App\Data\BoardColumn;
use App\Data\BoardContext;
use App\Data\StatusCounts;
use App\Enums\CaseStatus;
use App\Models\CaseRecord;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

final class BoardQuery
{
    public const PER_PAGE = 10;

    /**
     * @param  Request  $request
     * @return BoardContext
     */
    public static function context(Request $request): BoardContext
    {
        $counts = StatusCounts::fromDatabase();
        $pages = [];

        foreach (CaseStatus::cases() as $status) {
            $name = $status->value.'_page';
            $requested = $request->query($name);
            $page = is_scalar($requested) ? filter_var($requested, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) : false;
            $pages[$name] = min($page ?: 1, max(1, (int) ceil($counts->forStatus($status) / self::PER_PAGE)));
        }

        $columns = collect(CaseStatus::cases())->map(function (CaseStatus $status) use ($pages): BoardColumn {
            $name = $status->value.'_page';
            $cases = CaseListQuery::base()->where('status', $status)
                ->withCount('attachments')->orderByDesc('received_at')->orderByDesc('id')
                ->paginate(self::PER_PAGE, ['*'], $name, $pages[$name])->appends($pages)->fragment('board-'.$status->value);

            return new BoardColumn(status: $status, cases: $cases);
        });

        return new BoardContext(columns: $columns, query: $pages);
    }

    /**
     * @param  CaseRecord  $case
     * @return int
     */
    public static function pageFor(CaseRecord $case): int
    {
        $ahead = CaseListQuery::base()->where('status', $case->status)
            ->where(function (Builder $query) use ($case): void {
                $query->where('received_at', '>', $case->received_at)
                    ->orWhere(function (Builder $tied) use ($case): void {
                        $tied->where('received_at', $case->received_at)->where('id', '>', $case->id);
                    });
            })->count();

        return intdiv($ahead, self::PER_PAGE) + 1;
    }
}
