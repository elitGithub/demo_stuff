<?php

namespace App\Http\Controllers;

use App\Enums\AccountRole;
use App\Enums\PaymentKind;
use App\Exceptions\BookingConflictException;
use App\Http\Requests\BookingRequest;
use App\Http\Requests\ContinueBookingRequest;
use App\Http\Requests\InboxReadRequest;
use App\Services\AccountService;
use App\Services\BookingService;
use App\Services\InboxService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\View\View;
use Symfony\Component\HttpKernel\Exception\HttpException;

class BookingController extends Controller
{
    /**
     * @param ContinueBookingRequest $request
     * @param BookingService $bookings
     * @param AccountService $accounts
     * @return RedirectResponse
     */
    public function continueAsClient(ContinueBookingRequest $request, BookingService $bookings, AccountService $accounts): RedirectResponse
    {
        $bookings->review((int) $request->validated('service'), $request->validated('starts_local'), CarbonImmutable::now('UTC'));
        $accounts->switchRole(AccountRole::Client);

        return redirect()->route('bookings.review', ['service' => $request->validated('service'), 'starts_local' => $request->validated('starts_local')])->with('status', 'You are now requesting as the sample client. Your selected time is ready to review.');
    }

    /**
     * @param  BookingRequest  $request
     * @param  BookingService  $bookings
     * @return View|Response
     */
    public function review(BookingRequest $request, BookingService $bookings): View|Response
    {
        try {
            $review = $bookings->review((int) $request->validated('service'), $request->validated('starts_local'), CarbonImmutable::now('UTC'));
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() !== 409) {
                throw $exception;
            }

            return response()->view('bookings.conflict', ['problem' => $exception->getMessage(), 'existingBooking' => $exception instanceof BookingConflictException ? $exception->booking : null], 409);
        }

        return view('bookings.review', ['service' => $review->service, 'profile' => $review->profile, 'startsAt' => $review->startsAt, 'requestKey' => $review->requestKey, 'deposit' => $review->depositCents]);
    }

    /**
     * @param  BookingRequest  $request
     * @param  BookingService  $bookings
     * @return RedirectResponse|Response
     */
    public function store(BookingRequest $request, BookingService $bookings): RedirectResponse|Response
    {
        try {
            $booking = $bookings->request($request->user(), $request->inputData(), CarbonImmutable::now('UTC'));
        } catch (HttpException $exception) {
            if ($exception->getStatusCode() !== 409) {
                throw $exception;
            }
            $bookings->expireForActor($request->user(), CarbonImmutable::now('UTC'));

            return response()->view('bookings.conflict', ['problem' => $exception->getMessage(), 'existingBooking' => $exception instanceof BookingConflictException ? $exception->booking : null], 409);
        }

        return redirect()->route('bookings.show', $booking->id)->with('status', 'Your request is with the stylist. The time is not reserved yet.');
    }

    /**
     * @param  Request  $request
     * @param  BookingService  $bookings
     * @param  int  $booking
     * @return View
     */
    public function show(Request $request, BookingService $bookings, int $booking): View
    {
        $appointment = $bookings->visibleTo($request->user(), $booking);
        $bookings->expireFor($appointment->profile, CarbonImmutable::now('UTC'));
        $appointment->refresh();

        return view('bookings.show', ['booking' => $appointment, 'handoffRole' => $bookings->handoffRole($request->user(), $appointment), 'isClient' => $request->user()->hasRole(AccountRole::Client), 'bookingStatus' => $appointment->effectiveStatus(CarbonImmutable::now('UTC')), 'confirmationUrl' => app(InboxService::class)->confirmationUrl($request->user(), $appointment), 'isRefunded' => $appointment->payments()->where('kind', PaymentKind::Refund)->exists()]);
    }

    /**
     * @param  InboxReadRequest  $request
     * @param  BookingService  $bookings
     * @param  AccountService  $accounts
     * @param  int  $booking
     * @return RedirectResponse
     */
    public function handoff(InboxReadRequest $request, BookingService $bookings, AccountService $accounts, int $booking): RedirectResponse
    {
        $appointment = $bookings->visibleTo($request->user(), $booking);
        $role = $bookings->handoffRole($request->user(), $appointment);
        abort_if($role === null, 404);
        $actor = $accounts->switchRole($role);

        return redirect()->route('bookings.show', $appointment->id)->with('status', 'You are now viewing this appointment as '.$actor->name.', the '.$role->label().'.');
    }
}
