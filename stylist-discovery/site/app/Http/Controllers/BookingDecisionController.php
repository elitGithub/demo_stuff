<?php

namespace App\Http\Controllers;

use App\Enums\AccountRole;
use App\Enums\BookingStatus;
use App\Http\Requests\BookingDecisionRequest;
use App\Services\BookingService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;
use Illuminate\Support\MessageBag;
use Illuminate\Support\ViewErrorBag;
use Symfony\Component\HttpKernel\Exception\HttpException;

class BookingDecisionController extends Controller
{
    /**
     * @param  BookingDecisionRequest  $request
     * @param  BookingService  $bookings
     * @param  int  $booking
     * @return RedirectResponse|Response
     */
    public function update(BookingDecisionRequest $request, BookingService $bookings, int $booking): RedirectResponse|Response
    {
        $appointment = $bookings->visibleTo($request->user(), $booking);
        abort_unless($request->user()->hasRole(AccountRole::Stylist), 403);
        $now = CarbonImmutable::now('UTC');
        $bookings->expireFor($appointment->profile, $now);
        try {
            $appointment = $request->routeIs('bookings.accept') ? $bookings->accept($request->user(), $appointment, $now) : $bookings->decline($request->user(), $appointment, $request->validated('reason'), $now);
            if ($appointment->status === BookingStatus::Expired) {
                throw new HttpException(409, 'This request or deposit hold has expired. Choose a new appointment.');
            }
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() !== 409) {
                throw $exception;
            }
            $form = app(BookingController::class)->show($request, $bookings, $booking);

            return response()->view($form->name(), array_merge($form->getData(), ['errors' => (new ViewErrorBag)->put('default', new MessageBag(['booking' => $exception->getMessage()]))]), 409);
        }

        return redirect()->to(route('bookings.show', $appointment->id).'#save-result')->with('status', $appointment->status === BookingStatus::AwaitingDeposit ? 'Request accepted. The client can now complete the simulated deposit.' : 'Request declined. The client has been notified in their inbox.');
    }
}
