<?php

namespace App\Data;

use App\Enums\CaseStatus;
use App\Http\Requests\SearchCasesRequest;
use Carbon\CarbonImmutable;

final readonly class SearchFilters
{
    /**
     * @param  ?string  $text
     * @param  list<CaseStatus>  $statuses
     * @param  ?int  $trackedSenderId
     * @param  ?CarbonImmutable  $from
     * @param  ?CarbonImmutable  $to
     */
    public function __construct(
        public ?string $text,
        public array $statuses,
        public ?int $trackedSenderId,
        public ?CarbonImmutable $from,
        public ?CarbonImmutable $to,
    ) {}

    /**
     * @param  SearchCasesRequest  $request
     * @return self
     */
    public static function fromRequest(SearchCasesRequest $request): self
    {
        return new self(
            text: $request->validated('q'),
            statuses: array_map(CaseStatus::from(...), array_values($request->validated('status', []))),
            trackedSenderId: $request->validated('sender') === null ? null : (int) $request->validated('sender'),
            from: $request->validated('from') === null ? null : CarbonImmutable::parse($request->validated('from'))->startOfDay(),
            to: $request->validated('to') === null ? null : CarbonImmutable::parse($request->validated('to'))->startOfDay(),
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function parameters(): array
    {
        return array_filter([
            'q' => $this->text,
            'status' => array_map(fn (CaseStatus $status): string => $status->value, $this->statuses),
            'sender' => $this->trackedSenderId,
            'from' => $this->from?->toDateString(),
            'to' => $this->to?->toDateString(),
        ], fn (mixed $value): bool => $value !== null && $value !== []);
    }
}
