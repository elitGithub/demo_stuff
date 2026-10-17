<?php

namespace App\Data;

final readonly class MailboxPull
{
    /**
     * @param  list<IncomingMessage>  $messages
     * @param  ?string  $cursor
     * @param  list<RejectedMailboxMessage>  $rejected
     */
    public function __construct(
        public array $messages,
        public ?string $cursor,
        public array $rejected = [],
    ) {}
}
