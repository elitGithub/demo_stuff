<?php

namespace Elsewhere;

enum RateAction: string
{
    case Allocation = 'allocation';
    case Enquiry = 'enquiry';
    case Login = 'login';

    /** @return string */
    public function label(): string { return ucfirst($this->value); }
}
