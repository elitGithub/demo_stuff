<?php

namespace App\Data;

final readonly class ScriptProgress
{
    public bool $finished;

    /**
     * @param  int  $delivered
     * @param  int  $total
     */
    public function __construct(
        public int $delivered,
        public int $total,
    ) {
        $this->finished = $delivered === $total;
    }
}
