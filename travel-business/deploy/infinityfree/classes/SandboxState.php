<?php

namespace Elsewhere;

enum SandboxState: string
{
    case Pending = 'pending';
    case Ready = 'ready';
    case Failed = 'failed';

    /** @return string */
    public function label(): string { return ucfirst($this->value); }
}
