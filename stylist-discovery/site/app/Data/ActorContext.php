<?php

namespace App\Data;

final readonly class ActorContext
{
    /**
     * @param  ?int  $userId
     * @param  string  $revision
     * @param  string  $generation
     * @return void
     */
    public function __construct(public ?int $userId, public string $revision, public string $generation) {}
}
