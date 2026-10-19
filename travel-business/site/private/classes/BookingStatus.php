<?php

namespace Elsewhere;

enum BookingStatus: string
{
    case Planning = 'planning';
    case Confirmed = 'confirmed';
    case Cancelled = 'cancelled';

    /** @return string */
    public function label(): string { return ucfirst($this->value); }
}
