<?php

namespace App\Data;

use Illuminate\Support\Collection;

final readonly class BoardContext
{
    /**
     * @param  Collection<int, BoardColumn>  $columns
     * @param  array<string, int>  $query
     */
    public function __construct(public Collection $columns, public array $query) {}
}
