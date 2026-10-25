@component('layouts.app', ['title' => 'Check your appointment'])
    <section class="booking-panel booking-recovery" role="status" tabindex="-1" data-recovery-result>
        <p class="eyebrow">YOUR APPOINTMENT</p>
        <h1>{{ $existingBooking ? ($existingBooking->status === \App\Enums\BookingStatus::Requested ? 'This appointment is already requested.' : 'Your appointment is already here.') : $problem }}</h1>
        @if($existingBooking)<p><strong>{{ $existingBooking->service_name }}</strong><br>{{ $existingBooking->starts_at->setTimezone($existingBooking->timezone)->format('l, d F · H:i') }} · {{ $existingBooking->timezone }}</p><p>{{ $problem }} Continue with your existing appointment below.</p>@endif
        <div class="form-actions">@if($existingBooking)<a class="text-link" href="{{ route('discovery.index') }}">Choose another appointment</a><a class="button" href="{{ route('bookings.show', $existingBooking->id) }}">View your request →</a>@else<a class="button" href="{{ route('discovery.index') }}">Find another appointment →</a>@endif</div>
    </section>
@endcomponent
