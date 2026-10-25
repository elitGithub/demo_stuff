<?php

namespace App\Services;

use App\Enums\InboxEvent;
use App\Models\Booking;
use App\Models\InboxMessage;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

class InboxService
{
    /** @param User $actor
     * @param Booking $booking
     * @return string */
    public function confirmationUrl(User $actor, Booking $booking): string
    {
        $message = InboxMessage::query()->ownedBy($actor->id)->where('booking_id', $booking->id)->where('event', InboxEvent::DepositPaid)->orderBy('id')->first();
        if ($message === null) {
            return route('inbox.index').'#messages';
        }
        $newer = InboxMessage::query()->ownedBy($actor->id)->where('id', '>', $message->id)->count();

        return route('inbox.index', ['page' => intdiv($newer, config('demo.pagination')) + 1]).'#message-'.$message->id;
    }

    /**
     * @param  Booking  $booking
     * @param  User  $recipient
     * @param  InboxEvent  $event
     * @return InboxMessage
     */
    public function record(Booking $booking, User $recipient, InboxEvent $event): InboxMessage
    {
        return DB::connection('visitor')->transaction(function () use ($booking, $recipient, $event): InboxMessage {
            $eventKey = 'booking:'.$booking->id.':'.$event->value;
            $previous = InboxMessage::query()->ownedBy($recipient->id)->where('booking_id', $booking->id)->where('event', $event)->orderBy('id')->first();
            if ($previous !== null) {
                return $previous;
            }
            $booking->refresh();
            abort_if($booking->notification_budget < 1, 429, 'This appointment has no remaining notification capacity.');
            $detail = $booking->service_name.' · '.$booking->starts_at->setTimezone($booking->timezone)->format('d M Y H:i').' '.$booking->timezone.'. ';
            $body = match ($event) {
                InboxEvent::RequestReceived => 'Review this request and accept or decline. A request does not reserve the time.',
                InboxEvent::RequestAccepted => 'Your time is held until '.$booking->deposit_deadline->setTimezone($booking->timezone)->format('d M H:i').' '.$booking->timezone.'. Complete the simulated deposit to confirm.',
                InboxEvent::RequestDeclined => 'The stylist declined this request. Browse another time or studio.',
                InboxEvent::BookingExpired => 'The request or deposit hold expired. Choose a new appointment.',
                InboxEvent::DepositPaid => 'Your simulated deposit is recorded and your appointment is confirmed. No real payment was taken.',
                InboxEvent::BookingCancelled => 'This appointment was cancelled. Open it to review the details.',
                InboxEvent::DepositRefunded => 'The simulated deposit refund is recorded. No real money was moved.',
            };
            $message = InboxMessage::query()->create(['recipient_id' => $recipient->id, 'booking_id' => $booking->id, 'event' => $event, 'event_key' => $eventKey, 'subject' => $event->label().' · '.$booking->service_name, 'body' => $detail.$body]);
            $booking->decrement('notification_budget');

            return $message;
        });
    }

    /**
     * @param  User  $actor
     * @param  int  $page
     * @return LengthAwarePaginator<InboxMessage>
     */
    public function messages(User $actor, int $page): LengthAwarePaginator
    {
        return InboxMessage::query()->ownedBy($actor->id)->with('booking')->orderByDesc('id')->paginate(config('demo.pagination'), ['*'], 'page', $page);
    }

    /**
     * @param  User  $actor
     * @param  InboxMessage  $message
     * @return void
     */
    public function markRead(User $actor, InboxMessage $message): void
    {
        Gate::forUser($actor)->authorize('update', $message);
        InboxMessage::query()->ownedBy($actor->id)->whereKey($message->id)->whereNull('read_at')->update(['read_at' => CarbonImmutable::now('UTC')]);
    }
}
