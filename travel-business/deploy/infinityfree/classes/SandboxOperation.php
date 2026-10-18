<?php

namespace Elsewhere;

enum SandboxOperation: string
{
    case Bootstrap = 'bootstrap';
    case CreateEnquiry = 'create_enquiry';
    case Login = 'login';
    case Logout = 'logout';
    case Overview = 'overview';
    case UpdateStatus = 'update_status';
    case CreateBooking = 'create_booking';

    /** @return string */
    public function label(): string { return ucfirst(str_replace('_', ' ', $this->value)); }
}
