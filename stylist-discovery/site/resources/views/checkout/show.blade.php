@component('layouts.app', ['title' => 'Simulated deposit'])
    <a class="back-link" href="{{ route('bookings.show', $booking->id) }}">← Back to appointment</a>
    <section class="booking-heading"><p class="eyebrow">CLIENT PERSPECTIVE / STEP 3 OF 3</p><h1>Make it <em>official.</em></h1><p>A simulated deposit confirms your time with {{ $booking->profile->display_name }}.</p></section>
    <div class="booking-layout"><section class="booking-panel booking-primary" id="save-result" data-save-result tabindex="-1">
        <div class="checkout-appointment"><p class="eyebrow">APPOINTMENT #{{ $booking->id }} · SIMULATED CHECKOUT</p><h2>{{ $booking->service_name }}</h2><p>{{ $booking->profile->studio_name }} · {{ $booking->starts_at->setTimezone($booking->timezone)->format('D, d M · H:i') }}<br>{{ $booking->timezone }} · {{ $booking->duration_minutes }} minutes</p><dl><div><dt>Full service</dt><dd>€{{ number_format($booking->price_cents / 100, 2) }}</dd></div><div><dt>Deposit to confirm</dt><dd>€{{ number_format($booking->deposit_cents / 100, 2) }}</dd></div><div><dt>Balance at studio</dt><dd>€{{ number_format($booking->remaining_cents / 100, 2) }}</dd></div></dl></div>
        <h2>€{{ number_format($booking->deposit_cents / 100, 2) }} to confirm</h2>
        <p>No card details. No real charge. Choose an outcome to experience the booking flow.</p>
        @if(session('status'))<p class="success-notice" role="status">{{ session('status') }}</p>@endif
        <x-field-errors :errors="$errors" />
        <p class="deposit-deadline">Your time is held until <strong>{{ $booking->deposit_deadline->setTimezone($booking->timezone)->format('d M · H:i') }}</strong><span>{{ $booking->timezone }} · The deadline does not extend on retry.</span></p>
        <div class="checkout-options">
            <form method="post" action="{{ route('checkout.store', $booking->id) }}" data-loading-form>@csrf<x-actor-context /><input type="hidden" name="outcome" value="{{ \App\Enums\CheckoutOutcome::Succeeded->value }}"><x-loading-button label="Simulate successful deposit" progress="Recording simulated deposit…" /></form>
            <form method="post" action="{{ route('checkout.store', $booking->id) }}" data-loading-form>@csrf<x-actor-context /><input type="hidden" name="outcome" value="{{ \App\Enums\CheckoutOutcome::Failed->value }}"><button class="button button-outline" type="submit">Try a failed payment</button><span data-loading-status role="status" hidden>Trying simulated failure…</span></form>
        </div>
        <p class="field-help">A failed attempt keeps the appointment on hold so you can try again. Leaving checkout changes nothing.</p>
        <a class="text-link" href="{{ route('bookings.show', $booking->id) }}">Leave checkout →</a>
    </section><aside class="appointment-summary checkout-summary"><p class="eyebrow">APPOINTMENT #{{ $booking->id }}</p><h2>{{ $booking->service_name }}</h2><p>{{ $booking->profile->studio_name }}</p><p>{{ $booking->starts_at->setTimezone($booking->timezone)->format('l, d F · H:i') }}<br>{{ $booking->timezone }} · {{ $booking->duration_minutes }} minutes</p><dl><div><dt>Full service</dt><dd>€{{ number_format($booking->price_cents / 100, 2) }}</dd></div><div><dt>Simulated deposit</dt><dd>€{{ number_format($booking->deposit_cents / 100, 2) }}</dd></div><div><dt>Balance at the studio</dt><dd>€{{ number_format($booking->remaining_cents / 100, 2) }}</dd></div></dl></aside></div>
@endcomponent
