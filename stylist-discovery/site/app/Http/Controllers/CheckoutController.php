<?php

namespace App\Http\Controllers;

use App\Enums\BookingStatus;
use App\Enums\CheckoutOutcome;
use App\Http\Requests\CheckoutRequest;
use App\Services\BookingService;
use App\Services\PaymentService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\View\View;
use Symfony\Component\HttpKernel\Exception\HttpException;

class CheckoutController extends Controller
{
    /** @param Request $request
     * @param BookingService $bookings
     * @param int $booking
     * @return View|RedirectResponse */
    public function show(Request $request, BookingService $bookings, int $booking): View|RedirectResponse
    {
        $appointment = $bookings->visibleTo($request->user(), $booking);
        Gate::forUser($request->user())->authorize('pay', $appointment);
        $bookings->expireFor($appointment->profile, CarbonImmutable::now('UTC'));
        $appointment->refresh();
        if ($appointment->status !== BookingStatus::AwaitingDeposit) {
            return redirect()->route('bookings.show', $appointment->id);
        }

        return view('checkout.show', ['booking' => $appointment]);
    }

    /** @param CheckoutRequest $request
     * @param BookingService $bookings
     * @param PaymentService $payments
     * @param int $booking
     * @return RedirectResponse|Response */
    public function store(CheckoutRequest $request, BookingService $bookings, PaymentService $payments, int $booking): RedirectResponse|Response
    {
        $appointment = $bookings->visibleTo($request->user(), $booking);
        $now = CarbonImmutable::now('UTC');
        try {
            $result = $payments->checkout($request->user(), $appointment, CheckoutOutcome::from($request->validated('outcome')), $now);
            if ($result->booking->status === BookingStatus::Expired) {
                return response()->view('bookings.conflict', ['problem' => 'Your deposit hold has expired. No simulated payment was recorded. Find a new appointment.', 'existingBooking' => $result->booking], 409);
            }
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() !== 409) {
                throw $exception;
            }
            $bookings->expireForActor($request->user(), $now);

            return response()->view('bookings.conflict', ['problem' => $exception->getMessage(), 'existingBooking' => $appointment->refresh()], 409);
        }
        if ($result->outcome === CheckoutOutcome::Failed) {
            return redirect()->to(route('checkout.show', $appointment->id).'#save-result')->with('status', 'The simulated payment failed. Nothing was charged; your original hold deadline is unchanged. Try again before it expires.');
        }

        return redirect()->to(route('bookings.show', $appointment->id).'#save-result')->with('status', 'Appointment confirmed. Your simulated deposit and private confirmation are recorded. No real money was taken.');
    }
}
