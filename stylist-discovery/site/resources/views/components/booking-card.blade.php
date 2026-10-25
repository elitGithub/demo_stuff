@props(['booking', 'now'])
<article class="booking-panel workspace-card">
    <div class="inbox-message-heading"><span class="studio-status">{{ $booking->effectiveStatus($now)->label() }}</span><span class="eyebrow">#{{ $booking->id }}</span></div>
    <h3><a href="{{ route('bookings.show', $booking->id) }}">{{ $booking->service_name }}</a></h3><p>{{ auth()->user()->hasRole(\App\Enums\AccountRole::Stylist) ? $booking->client->name : $booking->profile->display_name }} · {{ $booking->profile->studio_name }}</p>
    <p class="workspace-card-time">{{ $booking->starts_at->setTimezone($booking->timezone)->format('D, d M Y · H:i') }}<span>{{ $booking->timezone }} · {{ $booking->duration_minutes }} min</span></p>
    @if($booking->isPayable($now))<p class="workspace-deadline">Deposit due {{ $booking->deposit_deadline->setTimezone($booking->timezone)->format('d M · H:i') }} {{ $booking->timezone }}</p>@endif
    <div class="workspace-card-footer"><span>
        @if(in_array($booking->status, [\App\Enums\BookingStatus::Cancelled, \App\Enums\BookingStatus::Expired, \App\Enums\BookingStatus::Declined], true))
            No balance due
        @else
            €{{ number_format($booking->remaining_cents / 100, 2) }} {{ $booking->status === \App\Enums\BookingStatus::Completed ? 'original studio balance' : 'balance at studio' }}
        @endif
    </span><a class="text-link" href="{{ route('bookings.show', $booking->id) }}">{{ $booking->isPayable($now) && auth()->user()->hasRole(\App\Enums\AccountRole::Client) ? 'Complete deposit' : ($booking->status === \App\Enums\BookingStatus::Requested && auth()->user()->hasRole(\App\Enums\AccountRole::Stylist) ? 'Review request' : 'Open appointment') }} →</a></div>
</article>
