@extends('layouts.app')
@section('title', 'Appointments')
@section('content')
    <div class="page-heading">
        <div><span class="eyebrow">A LITTLE ORDER, A LOT OF POSSIBILITY</span>
            <h1>Your studio, in rhythm.</h1>
            <p>See who’s coming in and make space for what’s next.</p>
        </div><a class="button" href="{{ route('appointments.create') }}">@include('components.icon', ['name' => 'plus']) New appointment</a>
    </div>
    <div class="calendar-toolbar">
        <div class="date-navigation"><a class="icon-button"
                href="{{ route('appointments.index', ['date' => $day->subDay()->toDateString()]) }}"
                aria-label="Previous day">←</a>
            <h2>{{ $day->format('F j, Y') }}</h2><a class="icon-button"
                href="{{ route('appointments.index', ['date' => $day->addDay()->toDateString()]) }}"
                aria-label="Next day">→</a><a class="button secondary small"
                href="{{ route('appointments.index') }}">Today</a>
        </div>
        <form class="inline-form" method="get"><label class="sr-only" for="schedule-date">Jump to date</label><input
                id="schedule-date" type="date" name="date" value="{{ $day->toDateString() }}"><button
                class="button secondary small">Go</button></form>
        <div class="segmented"><button type="button" class="selected" data-view="calendar">Day view</button><button
                type="button" data-view="list">List</button></div>
    </div>
    <div class="week-strip">
        @for ($i = 0; $i < 7; $i++)
            @php($date = $day->startOfWeek()->addDays($i))
            <a href="{{ route('appointments.index', ['date' => $date->toDateString()]) }}"
                class="{{ $date->isSameDay($day) ? 'selected' : '' }}"><span>{{ $date->format('D') }}</span><strong>{{ $date->format('d') }}</strong><i
                    class="{{ $date->isToday() ? 'today-dot' : '' }}"></i></a>
        @endfor
    </div>
    <section class="panel no-padding" data-calendar-view="calendar">
        <div class="calendar-scroll" style="--team-count:{{ $stylists->count() }};--hours:{{ $endHour - $startHour }}">
            <div class="calendar-head">
                <div>{{ config('studio.timezone') }}</div>
                @foreach ($stylists as $stylist)
                    <div><span class="stylist-dot"
                            style="--stylist:{{ $stylist->color }}"></span><strong>{{ $stylist->name }}</strong><small>{{ $stylist->title }}</small>
                    </div>
                @endforeach
            </div>
            <div class="calendar-body">
                <div class="time-labels">
                    @for ($hour = $startHour; $hour < $endHour; $hour++)
                        <span>{{ sprintf('%02d:00', $hour) }}</span>
                    @endfor
                </div>
                @foreach ($stylists as $stylist)
                    <div class="calendar-lane">
                        @foreach ($appointments->where('stylist_id', $stylist->id)->where('status', '!=', 'cancelled') as $appointment)
                            @php($top = ($appointment->localStart()->hour - $startHour) * 64 + ($appointment->localStart()->minute / 60) * 64)@php($height = max(48, ($appointment->starts_at->diffInMinutes($appointment->ends_at) / 60) * 64))
                            <a class="calendar-event {{ $appointment->status }}"
                                style="top:{{ $top }}px;min-height:{{ $height }}px;--stylist:{{ $stylist->color }}"
                                href="{{ route('appointments.show', $appointment) }}"><small>{{ $appointment->localStart()->format('H:i') }}
                                    ·
                                    {{ $appointment->localEnd()->format('H:i') }}</small><strong>{{ $appointment->client->name }}</strong><span>{{ $appointment->items->pluck('name')->implode(' + ') }}</span></a>
                        @endforeach
                    </div>
                @endforeach
            </div>
        </div>
    </section>
    <section class="panel no-padding" data-calendar-view="list" hidden>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>TIME</th>
                        <th>CLIENT & SERVICE</th>
                        <th>STYLIST</th>
                        <th>STATUS</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    @forelse($appointments as $appointment)
                        @include('components.appointment-row')@empty
                        <tr>
                            <td colspan="5" class="empty">Nothing booked for this day. A fresh start.</td>
                        </tr>
                    @endforelse
                </tbody>
            </table>
        </div>
    </section>
@endsection
