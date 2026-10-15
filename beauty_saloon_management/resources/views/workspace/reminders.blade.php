@extends('layouts.app')
@section('title', 'Reminders')
@section('content')<div class="page-heading">
        <div><span class="eyebrow">A THOUGHTFUL LITTLE NUDGE</span>
            <h1>Keep the connection.</h1>
            <p>Email, SMS and WhatsApp reminders, ready when your clients need them.</p>
        </div>
        <form method="post" action="{{ route('reminders.process') }}">@csrf<button class="button">@include('components.icon', ['name' => 'bell'])
                Preview due reminders</button></form>
    </div>
    <div class="notice preview-notice">
        <div><strong>You're in preview mode.</strong> Messages are saved here for review. No emails, texts or WhatsApp
            messages are sent.</div><span class="badge pending">Preview only</span>
    </div>
    <div class="channel-grid">
        @foreach (['email' => ['Email', 'A little care in their inbox.'], 'sms' => ['SMS', 'A quick, timely reminder.'], 'whatsapp' => ['WhatsApp', 'A familiar way to stay in touch.']] as $key => [$label, $description])
            <article class="panel channel-card"><span
                    class="channel-icon">{{ $key === 'email' ? '@' : ($key === 'sms' ? '☏' : 'W') }}</span>
                <h2>{{ $label }}</h2>
                <p class="muted">{{ $description }}</p><span class="badge pending">Preview ready</span>
            </article>
        @endforeach
    </div>
    <section class="panel no-padding mt">
        <div class="panel-heading padded">
            <h2>The reminder outbox <span class="count">{{ $pending }} queued</span></h2><span
                class="muted">{{ $simulated }} previewed</span>
        </div>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>CLIENT</th>
                        <th>CHANNEL</th>
                        <th>READY AT</th>
                        <th>STATUS</th>
                        <th>MESSAGE</th>
                    </tr>
                </thead>
                <tbody>
                    @forelse($reminders as $reminder)
                        <tr>
                            <td><a
                                    href="{{ route('clients.show', $reminder->appointment->client) }}"><strong>{{ $reminder->appointment->client->name }}</strong></a><small>{{ $reminder->recipient }}</small>
                            </td>
                            <td>{{ ucfirst($reminder->channel) }}</td>
                            <td>{{ $reminder->scheduled_at->setTimezone(config('studio.timezone'))->format('M j, H:i') }}
                            </td>
                            <td>@include('components.status', ['status' => $reminder->status])</td>
                            <td>
                                <details class="message-preview">
                                    <summary>Read message</summary>
                                    <p>{{ $reminder->body }}</p>
                                </details>
                            </td>
                    </tr>@empty<tr>
                            <td colspan="5" class="empty">Reminders will appear when an appointment is booked for a
                                consenting client.</td>
                        </tr>
                    @endforelse
                </tbody>
            </table>
        </div>@include('components.pagination', ['records' => $reminders])
</section>@endsection
