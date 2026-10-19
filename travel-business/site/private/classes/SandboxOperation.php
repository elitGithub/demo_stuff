<?php

namespace Elsewhere;

enum SandboxOperation: string
{
    case BOOTSTRAP      = 'bootstrap';
    case CREATE_ENQUIRY = 'create_enquiry';
    case LOGIN          = 'login';
    case LOGOUT         = 'logout';
    case OVERVIEW       = 'overview';
    case UPDATE_STATUS  = 'update_status';
    case CREATE_BOOKING = 'create_booking';

    /** @return string */
    public function label(): string
    {
        return ucfirst(str_replace('_', ' ', $this->value));
    }
}
