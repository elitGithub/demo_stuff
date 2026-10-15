@extends('layouts.app')
@section('title', 'Appointment details')
@section('content')
    <div class="page-heading">
        <div><a class="back-link"
                href="{{ route('appointments.index', ['date' => $appointment->localStart()->toDateString()]) }}">← Back to
                calendar</a>
            <h1>{{ $appointment->client->name }}’s visit</h1>
            <p>{{ $appointment->localStart()->format('l, F j, Y') }} ·
                {{ $appointment->localStart()->format('H:i') }}–{{ $appointment->localEnd()->format('H:i') }}</p>
        </div>@include('components.status', ['status' => $appointment->status])
    </div>
    <div class="detail-grid">
        <div class="stack">
            <section class="panel">
                <div class="panel-heading">
                    <h2>The appointment</h2><span class="muted">With {{ $appointment->stylist->name }}</span>
                </div>
                @foreach ($appointment->items as $item)
                    <div class="line-item">
                        <div><strong>{{ $item->name }}</strong><small>{{ $item->duration }} minutes</small></div>
                        <strong>{{ \App\Support\Money::format($item->price) }}</strong>
                    </div>
                @endforeach
                <div class="summary-line total">
                    <span>Service total</span><strong>{{ \App\Support\Money::format($appointment->total) }}</strong>
                </div>
                @if ($appointment->notes)
                    <div class="preference-note">
                        <div><strong>A note for this visit</strong>
                            <p>{{ $appointment->notes }}</p>
                        </div>
                    </div>
                @endif
                <div class="action-row mt">
                    @if ($appointment->status === 'booked')
                        <form method="post" action="{{ route('appointments.status', $appointment) }}">@csrf<input
                                type="hidden" name="status" value="confirmed"><button class="button">Confirm
                                appointment</button></form>
                        @endif @if (in_array($appointment->status, ['booked', 'confirmed']))
                            @if ($appointment->starts_at->isPast())
                                <form method="post" action="{{ route('appointments.status', $appointment) }}">@csrf<input
                                        type="hidden" name="status" value="completed"><button
                                        class="button">@include('components.icon', ['name' => 'check']) Complete visit</button></form>
                                <form method="post" action="{{ route('appointments.status', $appointment) }}">@csrf<input
                                        type="hidden" name="status" value="no_show"><button class="button secondary">Mark
                                        no-show</button></form>
                            @endif
                            <form method="post" action="{{ route('appointments.status', $appointment) }}"
                                data-confirm="Cancel this appointment? The time will become available again.">
                                @csrf<input type="hidden" name="status" value="cancelled"><button
                                    class="button danger-outline">Cancel appointment</button></form>
                        @endif
                </div>
            </section>
            @if (in_array($appointment->status, ['booked', 'confirmed']))
                <section class="panel">
                    <div class="panel-heading">
                        <h2>A change of plans?</h2>
                    </div>
                    <form method="post" action="{{ route('appointments.reschedule', $appointment) }}" class="form-grid">
                        @csrf<label>New date<input type="date" name="date"
                                value="{{ old('date', $appointment->localStart()->toDateString()) }}"
                                required></label><label>New time<input type="time" name="time"
                                value="{{ old('time', $appointment->localStart()->format('H:i')) }}" required></label>
                        <p class="field-help">Availability is checked again before saving. Reminders follow the new time.
                        </p><button class="button secondary">Reschedule visit</button>
                    </form>
                </section>
            @endif
            <section class="panel">
                <div class="panel-heading">
                    <h2>Reminders</h2><a class="text-link" href="{{ route('reminders.index') }}">Open outbox ↗</a>
                </div>
                @forelse($appointment->reminders as $reminder)
                    <div class="line-item">
                        <div>
                            <strong>{{ ucfirst($reminder->channel) }}</strong><small>{{ $reminder->scheduled_at->setTimezone(config('studio.timezone'))->format('M j, H:i') }}</small>
                        </div>@include('components.status', ['status' => $reminder->status])
                </div>@empty<p class="muted">No reminder channels selected for this client.</p>
                @endforelse
            </section>
        </div>
        <aside class="stack">
            <section class="panel">
                <div class="person"><span
                        class="avatar large tone-{{ $appointment->client_id % 4 }}">{{ $appointment->client->initials() }}</span>
                    <div>
                        <h2>{{ $appointment->client->name }}</h2><small>{{ $appointment->client->email }}</small>
                    </div>
                </div>
                <div class="preference-note mt">@include('components.icon', ['name' => 'heart'])<div>
                        <strong>{{ $appointment->client->style_name ?: 'Their style story starts here' }}</strong>
                        <p>{{ $appointment->client->style_notes ?: 'Save their favourite look on the client profile.' }}
                        </p>
                    </div>
                </div><a class="button secondary full mt" href="{{ route('clients.show', $appointment->client) }}">Open
                    client profile ↗</a><a class="text-link block mt"
                    href="{{ route('appointments.create', ['client' => $appointment->client_id, 'repeat' => $appointment->id]) }}">Book
                    this visit again →</a>
            </section>
            @can('manage-studio')<section class="panel">
                <div class="panel-heading">
                    <h2>Billing</h2>@include('components.icon', ['name' => 'file'])
                </div>
                @if ($appointment->invoice)
                    <p>Invoice <strong>{{ $appointment->invoice->number }}</strong></p>@include('components.status', ['status' => $appointment->invoice->status])<a
                        class="button full mt" href="{{ route('invoices.show', $appointment->invoice) }}">Open invoice ↗</a>
                @elseif($appointment->status === 'completed')
                    <p class="muted">The visit is complete. Create an invoice from the recorded services.</p>
                    <form method="post" action="{{ route('appointments.invoice', $appointment) }}">@csrf<button
                        class="button full">Generate invoice</button></form>@else<p class="muted">Complete the visit to
                        generate its invoice.</p>
                @endif
            </section>@endcan
        </aside>
    </div>
@endsection
