<?php

namespace App\Exceptions;

use App\Models\Booking;
use Symfony\Component\HttpKernel\Exception\HttpException;

class BookingConflictException extends HttpException
{
    /**
     * @param  string  $message
     * @param  Booking  $booking
     */
    public function __construct(string $message, public readonly Booking $booking)
    {
        parent::__construct(409, $message);
    }
}
