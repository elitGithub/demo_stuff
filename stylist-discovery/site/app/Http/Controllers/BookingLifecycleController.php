<?php

namespace App\Http\Controllers;

use App\Http\Requests\CancelBookingRequest;
use App\Http\Requests\CompleteBookingRequest;
use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

class BookingLifecycleController extends Controller
{
    /** @param CancelBookingRequest $request
     * @param BookingService $bookings
     * @param int $booking
     * @return RedirectResponse|Response */
    public function cancel(CancelBookingRequest $request, BookingService $bookings, int $booking): RedirectResponse|Response
    {
        $appointment = $bookings->visibleTo($request->user(), $booking);
        $now = CarbonImmutable::now('UTC');
        try {
            $bookings->cancel($request->user(), $appointment, $request->validated('reason'), $now);
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() !== 409) {
                throw $exception;
            }
            $bookings->expireForActor($request->user(), $now);

            return response()->view('bookings.conflict', ['problem' => $exception->getMessage(), 'existingBooking' => $appointment->refresh()], 409);
        }

        return redirect()->to(route('bookings.show', $booking).'#save-result')->with('status', 'Appointment cancelled. Any captured simulated deposit has been refunded in full.');
    }

    /** @param CompleteBookingRequest $request
     * @param BookingService $bookings
     * @param int $booking
     * @return RedirectResponse|Response */
    public function complete(CompleteBookingRequest $request, BookingService $bookings, int $booking): RedirectResponse|Response
    {
        $appointment = $bookings->visibleTo($request->user(), $booking);
        try {
            $bookings->complete($request->user(), $appointment, CarbonImmutable::now('UTC'));
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() !== 409) {
                throw $exception;
            }

            return response()->view('bookings.conflict', ['problem' => $exception->getMessage(), 'existingBooking' => $appointment->refresh()], 409);
        }

        return redirect()->to(route('bookings.show', $booking).'#save-result')->with('status', 'Appointment marked complete. Your appointment history is up to date.');
    }
}
