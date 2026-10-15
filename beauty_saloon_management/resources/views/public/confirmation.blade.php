@extends('layouts.public')
@php
    $upcoming = in_array($appointment->status, ['booked', 'confirmed']);
    $heading = match ($appointment->status) {
        'cancelled' => 'This visit was cancelled',
        'completed' => 'Thank you for visiting.',
        'no_show' => 'We missed you.',
        default => 'See you in the chair.',
    };
@endphp
@section('title', $upcoming ? 'Your visit is booked' : $heading)
@section('content')<section class="confirmation panel">
        <div class="confirmation-check">@include('components.icon', ['name' => 'check'])</div><span
            class="eyebrow">{{ str_replace('_', ' ', strtoupper($appointment->status)) }}</span>
        <h1>{{ $heading }}</h1>
        <p>{{ $upcoming ? 'We’ve saved a little time just for you.' : 'Contact the studio if you would like to arrange another visit.' }}
        </p>
        <div class="confirmation-detail">
            <div><small>WHEN</small>
                <h3>{{ $appointment->localStart()->format('l, F j') }}</h3>
                <span>{{ $appointment->localStart()->format('H:i') }} – {{ $appointment->localEnd()->format('H:i') }} ·
                    {{ config('studio.timezone') }}</span>
            </div>
            <div><small>WITH</small>
                <h3>{{ $appointment->stylist->name }}</h3>
                <span>{{ $appointment->items->pluck('name')->implode(' + ') }}</span>
            </div>
        </div>
        <div class="summary-line total"><span>Service
                total</span><strong>{{ \App\Support\Money::format($appointment->total) }}</strong></div>
        <p class="field-help">
            @if ($upcoming)
                Payment is due at the studio.
            @endif Keep this private link to your booking.
            <br>For changes, call {{ config('studio.phone') }}.
        </p>
        @if (config('studio.demo'))
            <div class="notice">This demo saves your booking. Reminder messages are previewed in the studio workspace.</div>
        @endif
        <a class="button" href="{{ route('home') }}">Back to the studio @include('components.icon', ['name' => 'arrow'])</a>
</section>@endsection
