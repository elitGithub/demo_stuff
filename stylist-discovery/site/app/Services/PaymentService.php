<?php

namespace App\Services;

use App\Data\CheckoutResult;
use App\Enums\BookingStatus;
use App\Enums\CheckoutOutcome;
use App\Enums\InboxEvent;
use App\Enums\PaymentKind;
use App\Models\Booking;
use App\Models\Payment;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;
use LogicException;

class PaymentService
{
    /** @param User $actor
     * @param Booking $booking
     * @param CheckoutOutcome $outcome
     * @param CarbonImmutable $now
     * @return CheckoutResult */
    public function checkout(User $actor, Booking $booking, CheckoutOutcome $outcome, CarbonImmutable $now): CheckoutResult
    {
        Gate::forUser($actor)->authorize('pay', $booking);

        return DB::connection('visitor')->transaction(function () use ($booking, $outcome, $now): CheckoutResult {
            $profile = $booking->profile;
            $profile->increment('booking_lock_version');
            $profile->refresh();
            app(BookingService::class)->expireFor($profile, $now);
            $booking->refresh();
            if ($booking->status === BookingStatus::Expired) {
                return new CheckoutResult(booking: $booking, outcome: CheckoutOutcome::Failed);
            }
            if (in_array($booking->status, [BookingStatus::Confirmed, BookingStatus::Completed], true)) {
                $deposit = $booking->payments()->where('kind', PaymentKind::Deposit)->first();
                abort_unless($deposit !== null && $deposit->amount_cents === $booking->deposit_cents && $deposit->currency === $booking->currency, 409, 'The deposit record needs attention.');

                return new CheckoutResult(booking: $booking, outcome: CheckoutOutcome::Succeeded);
            }
            abort_unless($booking->status === BookingStatus::AwaitingDeposit, 409, 'This appointment is no longer awaiting a deposit.');
            try {
                app(AvailabilityService::class)->assertAvailable($profile, $booking->starts_at, $booking->ends_at, $booking->id, $now);
            } catch (ValidationException) {
                abort(409, 'The studio schedule has changed. Return to your appointment or contact the stylist.');
            }
            if ($outcome === CheckoutOutcome::Failed) {
                return new CheckoutResult(booking: $booking, outcome: $outcome);
            }
            $booking->payments()->create(['kind' => PaymentKind::Deposit, 'amount_cents' => $booking->deposit_cents, 'currency' => $booking->currency]);
            $booking->update(['status' => BookingStatus::Confirmed]);
            foreach ([$booking->client, $profile->user] as $recipient) {
                app(InboxService::class)->record($booking, $recipient, InboxEvent::DepositPaid);
            }

            return new CheckoutResult(booking: $booking->refresh(), outcome: $outcome);
        });
    }

    /** @param Booking $booking
     * @return Payment */
    public function refund(Booking $booking): Payment
    {
        if (DB::connection('visitor')->transactionLevel() < 1) {
            throw new LogicException('Refund requires an active cancellation transaction.');
        }
        $deposit = $booking->payments()->where('kind', PaymentKind::Deposit)->sole();
        if ($deposit->amount_cents !== $booking->deposit_cents || $deposit->currency !== $booking->currency) {
            throw new LogicException('Deposit does not match the appointment snapshot.');
        }

        return $booking->payments()->firstOrCreate(['kind' => PaymentKind::Refund], ['amount_cents' => $deposit->amount_cents, 'currency' => $deposit->currency]);
    }
}
