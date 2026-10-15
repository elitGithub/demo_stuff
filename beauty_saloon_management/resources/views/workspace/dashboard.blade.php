@extends('layouts.app')
@section('title', 'Overview')
@section('content')
    <div class="page-heading">
        <div><span class="eyebrow">{{ strtoupper($today->format('l, F j')) }}</span>
            <h1>A good day starts here.</h1>
            <p>A little clarity for the day ahead. Let’s make it a good one.</p>
        </div><a href="{{ route('appointments.create') }}" class="button">@include('components.icon', ['name' => 'plus']) New appointment</a>
    </div>
    <div class="stats-grid">
        <article class="stat-card">
            <div><span>Appointments today</span>@include('components.icon', ['name' => 'calendar'])</div>
            <strong>{{ $appointments->where('status', '!=', 'cancelled')->count() }}<small>visits</small></strong>
            <p><span class="positive">{{ $appointments->where('status', 'completed')->count() }} completed</span> · a day of
                good hair</p>
        </article>
        <article class="stat-card">
            @can('manage-studio')<div><span>Revenue this month</span>@include('components.icon', ['name' => 'wallet'])</div>
            <strong>{{ \App\Support\Money::format($revenue) }}</strong>
            <p>Recorded payments · {{ $today->format('F') }}</p>@else<div><span>Still to welcome today</span>@include('components.icon', ['name' => 'clock'])</div><strong>{{ $appointments->whereIn('status', ['booked', 'confirmed'])->count() }}<small>visits</small></strong><p>Make every welcome count.</p>@endcan
        </article>
        <article class="stat-card">
            <div><span>Your client community</span>@include('components.icon', ['name' => 'users'])</div>
            <strong>{{ $clientCount }}<small>people</small></strong>
            <p>Every visit, a stronger connection</p>
        </article>
        <article class="stat-card accent-stat">
            <div><span>A little follow-up</span>@include('components.icon', ['name' => 'heart'])</div><strong>{{ $followUpCount }}<small>to
                    make</small></strong>
            <p>A thoughtful nudge goes a long way</p>
        </article>
    </div>
    <div class="dashboard-grid">
        <section class="panel no-padding agenda-panel">
            <div class="panel-heading padded">
                <div><span class="eyebrow">IN THE STUDIO</span>
                    <h2>Today’s appointments <span class="count">{{ $appointments->count() }}</span></h2>
                </div><a class="text-link" href="{{ route('appointments.index') }}">View calendar ↗</a>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>TIME</th>
                            <th>CLIENT & SERVICE</th>
                            <th>WITH</th>
                            <th>STATUS</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        @forelse($appointments as $appointment)
                            @include('components.appointment-row')@empty
                            <tr>
                                <td colspan="5" class="empty">A little breathing room. Book the first appointment for
                                    today.</td>
                            </tr>
                        @endforelse
                    </tbody>
                </table>
            </div>
            <div class="panel-footer"><span class="tiny-dot"></span> All times in {{ config('studio.timezone') }}<a
                    href="{{ route('appointments.create') }}">Make room for someone new +</a></div>
        </section>
        <aside class="stack">
            <section class="care-card">
                <div class="care-icon">@include('components.icon', ['name' => 'spark'])</div><span class="eyebrow">THOUGHTFUL BY DESIGN</span>
                <h2>Remember the<br><em>little things.</em></h2>
                <p>A favourite cut. The right stylist. A note from last time. Make every visit feel personal.</p><a
                    href="{{ route('clients.index') }}" class="text-link">Get to know your clients ↗</a><span
                    class="care-decoration">a.</span>
            </section>
            <section class="panel">
                <div class="panel-heading">
                    <h2>Keep in touch</h2><span class="small-label">FOLLOW-UPS</span>
                </div>
                @forelse($followUps as $followUp)
                    <div class="follow-up"><span
                            class="avatar small tone-{{ $followUp->client_id % 4 }}">{{ $followUp->client->initials() }}</span>
                        <div><a
                                href="{{ route('clients.show', $followUp->client) }}"><strong>{{ $followUp->client->name }}</strong></a><small>{{ $followUp->title }}</small><span
                                class="due-label {{ $followUp->due_date->isPast() ? 'overdue' : '' }}">{{ $followUp->due_date->format('M j') }}</span>
                        </div>
                        <form action="{{ route('follow-ups.complete', $followUp) }}" method="post">@csrf<button
                                class="icon-button"
                                aria-label="Complete follow-up for {{ $followUp->client->name }}">@include('components.icon', ['name' => 'check'])</button>
                        </form>
                </div>@empty<p class="muted">You're all caught up.</p>
                @endforelse
            </section>
        </aside>
    </div>
    <div class="dashboard-bottom">
        <section class="panel">
            <div class="panel-heading">
                <h2>On the horizon</h2><a class="text-link"
                    href="{{ route('appointments.index', ['date' => $today->addDay()->toDateString()]) }}">Tomorrow ↗</a>
            </div>
            @forelse($upcoming as $appointment)
                <a class="upcoming-item" href="{{ route('appointments.show', $appointment) }}"><span
                        class="date-tile"><b>{{ $appointment->localStart()->format('d') }}</b><small>{{ $appointment->localStart()->format('M') }}</small></span>
                    <div>
                        <strong>{{ $appointment->client->name }}</strong><small>{{ $appointment->items->pluck('name')->implode(' + ') }}</small>
                    </div><span>{{ $appointment->localStart()->format('H:i') }}</span>
            </a>@empty<p class="muted">No upcoming visits just yet.</p>
            @endforelse
        </section>
        <section class="panel">
            <div class="panel-heading">
                <h2>A growing community</h2><a class="text-link" href="{{ route('clients.index') }}">All clients ↗</a>
            </div>
            @foreach ($recentClients as $client)
                <a class="upcoming-item" href="{{ route('clients.show', $client) }}"><span
                        class="avatar tone-{{ $client->id % 4 }}">{{ $client->initials() }}</span>
                    <div>
                        <strong>{{ $client->name }}</strong><small>{{ $client->style_name ?: 'Ready for a fresh start' }}</small>
                    </div><span class="muted">{{ $client->appointments_count }} visits</span>
                </a>
            @endforeach
        </section>
    </div>
@endsection
