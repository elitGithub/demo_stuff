<?php

namespace Elsewhere;

enum RateAction: string
{
    case ALLOCATION = 'allocation';
    case ENQUIRY    = 'enquiry';
    case LOGIN      = 'login';

    /** @return string */
    public function label(): string
    {
        return ucfirst($this->value);
    }
}
