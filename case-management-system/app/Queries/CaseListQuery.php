<?php

namespace App\Queries;

use App\Data\ListContext;
use App\Data\StatusCounts;
use App\Enums\CaseStatus;
use App\Models\CaseRecord;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;

final readonly class CaseListQuery
{
    /**
     * @param  ?CaseStatus  $status
     */
    public function __construct(
        public ?CaseStatus $status,
    ) {}

    /**
     * @return Builder<CaseRecord>
     */
    public static function base(): Builder
    {
        return CaseRecord::query();
    }

    /**
     * @param  Request  $request
     * @return ListContext
     */
    public static function context(Request $request): ListContext
    {
        $status = $request->query('status');
        $list = new self(status: is_string($status) ? CaseStatus::tryFrom($status) : null);
        $cases = $list->paginate();

        return new ListContext(
            cases: $cases,
            counts: StatusCounts::fromDatabase(),
            status: $list->status,
            query: $list->parameters($cases->currentPage()),
        );
    }

    /**
     * @param  int  $perPage
     * @return LengthAwarePaginator<int, CaseRecord>
     */
    public function paginate(int $perPage = 25): LengthAwarePaginator
    {
        return self::base()
            ->with('latestMessage')
            ->withCount('attachments')
            ->when($this->status, fn (Builder $query, CaseStatus $status): Builder => $query->where('status', $status))
            ->orderByDesc('received_at')
            ->orderByDesc('id')
            ->paginate($perPage)
            ->appends($this->parameters());
    }

    /**
     * @param  int  $page
     * @return array<string, int|string>
     */
    public function parameters(int $page = 1): array
    {
        $parameters = $this->status === null ? [] : ['status' => $this->status->value];

        if ($page > 1) {
            $parameters['page'] = $page;
        }

        return $parameters;
    }
}
