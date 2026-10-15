@extends('layouts.app')
@section('title', 'Client profile')
@section('content')
    <div class="page-heading">
        <div><a class="back-link" href="{{ route('clients.index') }}">← Your people</a>
            <div class="person"><span class="avatar xlarge tone-{{ $client->id % 4 }}">{{ $client->initials() }}</span>
                <div>
                    <h1>{{ $client->name }}</h1>
                    <p>A familiar face since {{ $client->created_at->format('M Y') }} · {{ $client->appointments->count() }}
                        visits</p>
                </div>
            </div>
        </div><a class="button" href="{{ route('appointments.create', ['client' => $client->id]) }}">@include('components.icon', ['name' => 'calendar'])
            Book their next visit</a>
    </div>
    <div class="detail-grid">
        <div class="stack">
            <section class="style-card"><span class="eyebrow">THEIR SIGNATURE LOOK</span>
                <h2>{{ $client->style_name ?: 'Every style has a story.' }}</h2>
                <p>{{ $client->style_notes ?: 'Save the details that make their look their own.' }}</p>
                <div class="action-row"><span class="badge">Refresh every {{ $client->maintenance_weeks }} weeks</span>
                    @if ($client->preferredStylist)
                        <span class="badge">With {{ $client->preferredStylist->name }}</span>
                    @endif
                </div>
                @if ($client->style_photo)
                    <img class="style-photo" src="{{ route('clients.photo', $client) }}"
                        alt="{{ $client->name }}'s saved hairstyle reference">
                @endif
            </section>
            <section class="panel">
                <div class="panel-heading">
                    <h2>The visit story</h2><span class="muted">{{ $client->appointments->count() }} appointments</span>
                </div>
                @forelse($client->appointments as $appointment)
                    <div class="history-item"><span class="history-dot"></span>
                        <div class="history-content">
                            <div class="spread"><a
                                    href="{{ route('appointments.show', $appointment) }}"><strong>{{ $appointment->items->pluck('name')->implode(' + ') }}</strong></a>@include('components.status', ['status' => $appointment->status])
                            </div>
                            <p>{{ $appointment->localStart()->format('M j, Y · H:i') }} ·
                                {{ $appointment->stylist->name }}</p>
                            <div class="spread"><span>{{ \App\Support\Money::format($appointment->total) }}</span><a
                                    class="text-link"
                                    href="{{ route('appointments.create', ['client' => $client->id, 'repeat' => $appointment->id]) }}">Book
                                    again ↗</a></div>
                        </div>
                </div>@empty<p class="muted">No visits yet. Let's make the first one memorable.</p>
                @endforelse
            </section>
            <section class="panel">
                <div class="panel-heading">
                    <h2>The little details</h2><span class="small-label">PRIVATE STUDIO NOTES</span>
                </div>
                <form class="stack" method="post" action="{{ route('clients.note', $client) }}">@csrf<label
                        class="sr-only" for="client-note">New note</label>
                    <textarea id="client-note" name="body" rows="3" required maxlength="3000"
                        placeholder="A preference, a conversation, something to remember…"></textarea><button class="button secondary align-self-end">Add a note</button>
                </form>
                @foreach ($client->notes as $note)
                    <div class="note">
                        <p>{{ $note->body }}</p><small>{{ $note->user?->name ?: 'Studio team' }} ·
                            {{ $note->created_at->format('M j, Y') }}</small>
                    </div>
                @endforeach
            </section>
            <section class="panel">
                <div class="panel-heading">
                    <h2>Keep the connection</h2>
                </div>
                @foreach ($client->followUps->whereNull('completed_at') as $followUp)
                    <div class="line-item">
                        <div>
                            <strong>{{ $followUp->title }}</strong><small>{{ $followUp->due_date->format('M j, Y') }}</small>
                        </div>
                        <form action="{{ route('follow-ups.complete', $followUp) }}" method="post">@csrf<button
                                class="icon-button" aria-label="Complete follow-up">@include('components.icon', ['name' => 'check'])</button>
                        </form>
                    </div>
                @endforeach
                <form action="{{ route('clients.follow-up', $client) }}" method="post" class="form-grid mt">
                    @csrf<label>Follow-up<input name="title" placeholder="Time for a colour refresh" required
                            maxlength="200"></label><label>When<input type="date" name="due_date"
                            value="{{ now()->addWeeks($client->maintenance_weeks)->toDateString() }}"
                            required></label><button class="button secondary">Schedule follow-up</button></form>
            </section>
        </div>
        <aside>
            <form class="panel stack" method="post" action="{{ route('clients.update', $client) }}"
                enctype="multipart/form-data">@csrf @method('PUT')<div class="panel-heading">
                    <h2>Make it personal</h2>@include('components.icon', ['name' => 'heart'])
                </div><label>Name<input name="name" value="{{ old('name', $client->name) }}" required
                        maxlength="120"></label><label>Email<input type="email" name="email"
                        value="{{ old('email', $client->email) }}"></label><label>Phone<input name="phone"
                        value="{{ old('phone', $client->phone) }}" maxlength="30"></label>
                <label>Client type<select name="segment">
                    @foreach (['b2c' => 'Individual', 'b2b' => 'Business', 'b2g' => 'Government'] as $segment => $segmentLabel)
                        <option value="{{ $segment }}" @selected(old('segment', $client->segment) === $segment)>{{ $segmentLabel }}</option>
                    @endforeach
                </select></label><label>Company / organisation<input name="company" maxlength="160" value="{{ old('company', $client->company) }}"></label>
                <hr><label>Favourite style<input name="style_name" value="{{ old('style_name', $client->style_name) }}"
                        maxlength="120" placeholder="Soft layers, textured crop…"></label><label>Style notes
                    <textarea name="style_notes" rows="4" maxlength="3000">{{ old('style_notes', $client->style_notes) }}</textarea>
                </label><label>Reference photo<input type="file" name="style_photo"
                        accept="image/jpeg,image/png,image/webp"><small>JPG, PNG or WebP, up to 4 MB. Private to the
                        studio.</small></label><label>Preferred stylist<select name="preferred_stylist_id">
                        <option value="">No preference</option>
                        @foreach ($stylists as $stylist)
                            <option value="{{ $stylist->id }}" @selected(old('preferred_stylist_id', $client->preferred_stylist_id) == $stylist->id)>{{ $stylist->name }}</option>
                        @endforeach
                    </select>
                </label>
                <fieldset>
                    <legend>Favourite services</legend>
                    <div class="checkbox-stack">
                        @foreach ($services as $service)
                            <label><input type="checkbox" name="preferred_services[]" value="{{ $service->id }}"
                                    @checked(in_array($service->id, old('preferred_services', $client->preferred_services ?? [])))>{{ $service->name }}</label>
                        @endforeach
                    </div>
                </fieldset><label>Refresh every (weeks)<input type="number" name="maintenance_weeks"
                        value="{{ old('maintenance_weeks', $client->maintenance_weeks) }}" min="1" max="52"
                        required></label>
                <fieldset>
                    <legend>Reminder consent</legend>
                    <p class="field-help">Only select channels the client has agreed to use.</p>
                    <div class="checkbox-row">
                        @foreach (['email' => 'Email', 'sms' => 'SMS', 'whatsapp' => 'WhatsApp'] as $channel => $label)
                            <label><input type="checkbox" name="channels[]" value="{{ $channel }}"
                                    @checked(in_array($channel, old('channels', $client->channels ?? [])))>{{ $label }}</label>
                        @endforeach
                    </div>
                </fieldset>
                <hr><h3>Occasions & marketing</h3>
                <label>Birthday<input type="date" name="birthday" value="{{ old('birthday', $client->birthday?->toDateString()) }}" max="{{ now()->toDateString() }}"></label>
                <label>Anniversary<input type="date" name="anniversary" value="{{ old('anniversary', $client->anniversary?->toDateString()) }}" max="{{ now()->toDateString() }}"></label>
                <fieldset><legend>Marketing consent</legend><p class="field-help">Select only channels explicitly agreed for birthday and anniversary messages. This permission is separate from appointment reminders and the website newsletter.</p>
                    <div class="checkbox-row">
                        @foreach (['email' => 'Email', 'sms' => 'SMS', 'whatsapp' => 'WhatsApp'] as $channel => $label)
                            <label><input type="checkbox" name="marketing_channels[]" value="{{ $channel }}" @checked(in_array($channel, old('marketing_channels', $client->marketing_channels ?? [])))>{{ $label }}</label>
                        @endforeach
                    </div>
                </fieldset><button class="button full">Save client preferences</button>
            </form>
        </aside>
    </div>
@endsection
