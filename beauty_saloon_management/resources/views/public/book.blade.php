@extends($staff ? 'layouts.app' : 'layouts.public')
@section('title', $staff ? 'New appointment' : 'Book your visit')
@section('content')
    <div class="{{ $staff ? '' : 'booking-page' }}">
        <div class="page-heading">
            <div><span class="eyebrow">{{ $staff ? 'MAKE ROOM FOR A GOOD VISIT' : 'A LITTLE TIME, JUST FOR YOU' }}</span>
                <h1>{{ $staff ? 'New appointment' : 'Your next good hair day.' }}</h1>
                <p>{{ $client ? 'A familiar style for ' . $client->name . '.' : 'Choose your service, find your person, make it yours.' }}
                </p>
            </div>
            @if ($staff)
                <a class="button secondary" href="{{ route('appointments.index') }}">Back to calendar</a>
            @endif
        </div>
        @if (!$staff)
            @include('components.notices')
        @endif
        @if ($unavailableStylist)
            <div class="notice">The original stylist is unavailable. Choose another team member to continue this visit.</div>
        @endif
        @if ($repeat)
            <div class="notice">Repeating the services from {{ $repeat->localStart()->format('M j, Y') }}. Current prices
                apply. Resolve any unavailable selections before confirming.</div>
        @endif
        <form method="post" action="{{ route($staff ? 'appointments.store' : 'booking.store') }}" id="booking-form"
            data-availability="{{ route('availability') }}" data-currency="{{ config('studio.currency') }}"
            data-old-time="{{ old('time') }}">@csrf
            <div class="booking-grid">
                <div class="stack large-gap">
                    @if ($staff)
                        <section class="panel">
                            <div class="panel-heading">
                                <h2>The client</h2>
                            </div><label>Choose a client<select name="client_id" id="booking-client"
                                    data-url="{{ route('appointments.create') }}">
                                    <option value="">New client</option>
                                    @foreach ($clients as $person)
                                        <option value="{{ $person->id }}" @selected($client?->id === $person->id)>
                                            {{ $person->name }}</option>
                                    @endforeach
                                </select>
                            </label>
                            @if ($client)
                                <div class="preference-note">@include('components.icon', ['name' => 'heart'])<div>
                                        <strong>{{ $client->style_name ?: 'A fresh start' }}</strong>
                                        <p>{{ $client->style_notes ?: 'No style notes yet. Add their preferences after this visit.' }}
                                        </p>
                                    </div>
                                </div>
                            @endif
                        </section>
                    @endif
                    <section class="panel">
                        <div class="panel-heading">
                            <h2><span class="step-number">01</span> Choose your person</h2><span class="muted">A good match
                                matters</span>
                        </div><label class="sr-only" for="booking-stylist">Stylist</label><select name="stylist_id"
                            id="booking-stylist" required>
                            <option value="" @selected($unavailableStylist || !$selectedStylist)>Choose a stylist</option>
                            @foreach ($stylists as $stylist)
                                <option value="{{ $stylist->id }}"
                                    data-services="{{ $stylist->services->pluck('id')->implode(',') }}"
                                    @selected((int) $selectedStylist === $stylist->id)>{{ $stylist->name }} · {{ $stylist->title }}</option>
                            @endforeach
                        </select>
                    </section>
                    <section class="panel">
                        <div class="panel-heading">
                            <h2><span class="step-number">02</span> A little refresh or a new chapter?</h2>
                        </div>
                        <div class="booking-services">
                            @foreach ($services as $service)
                                <label class="service-option"><input type="checkbox" name="service_ids[]"
                                        value="{{ $service->id }}" data-active="{{ $service->active ? 1 : 0 }}"
                                        data-price="{{ $service->price }}" data-duration="{{ $service->duration }}"
                                        data-name="{{ $service->name }}"
                                        @checked(in_array($service->id, $selectedServices))><span><strong>{{ $service->name }}</strong><small>{{ $service->category }}
                                            · {{ $service->duration }} min</small><small
                                            data-service-eligibility>{{ $service->active ? '' : 'No longer offered — remove this selection to continue.' }}</small></span><b>{{ \App\Support\Money::format($service->price) }}</b></label>
                            @endforeach
                        </div>
                    </section>
                    <section class="panel">
                        <div class="panel-heading">
                            <h2><span class="step-number">03</span> Find a time that fits</h2><span
                                class="muted">{{ config('studio.timezone') }}</span>
                        </div>
                        <div class="form-grid"><label>Date<input type="date" name="date" id="booking-date"
                                    value="{{ old('date', now(config('studio.timezone'))->addDay()->format('Y-m-d')) }}"
                                    min="{{ now(config('studio.timezone'))->format('Y-m-d') }}"
                                    max="{{ now()->addMonths(6)->format('Y-m-d') }}" required></label><label>Available
                                time<select name="time" id="booking-time" required>
                                    <option value="">Choose services to see times</option>
                                </select></label></div>
                        <p class="field-help" id="availability-status" role="status">Times account for your full visit and
                            your stylist’s calendar.</p>
                    </section>
                    @if (!$client)
                        <section class="panel">
                            <div class="panel-heading">
                                <h2><span class="step-number">04</span> The finishing details</h2>
                            </div>
                            <div class="form-grid"><label class="span-2">Your name<input name="name"
                                        value="{{ old('name') }}" maxlength="120" autocomplete="name" required
                                        placeholder="First and last name"></label><label>Email<input type="email"
                                        name="email" value="{{ old('email') }}" autocomplete="email" required
                                        placeholder="you@example.com"></label><label>Phone<input type="tel"
                                        name="phone" value="{{ old('phone') }}" autocomplete="tel" maxlength="30"
                                        required placeholder="Include country code"></label></div><label class="mt">A
                                note for your stylist <span class="muted">(optional)</span>
                                <textarea name="notes" rows="2" maxlength="2000" placeholder="Anything you’d like us to know?">{{ old('notes') }}</textarea>
                            </label>
                            <div class="consent"><strong>Appointment reminders</strong>
                                <p class="field-help">Choose how we may contact you about this visit.</p>
                                <div class="checkbox-row">
                                    @foreach (['email' => 'Email', 'sms' => 'SMS', 'whatsapp' => 'WhatsApp'] as $channel => $label)
                                        <label><input type="checkbox" name="channels[]" value="{{ $channel }}"
                                                @checked(in_array($channel, old('channels', [])))>{{ $label }}</label>
                                    @endforeach
                                </div>
                            </div>
                        </section>
                    @endif
                </div>
                <aside class="booking-summary panel"><span class="eyebrow">YOUR VISIT</span>
                    <h2>A little time<br><em>well spent.</em></h2>
                    <div id="selected-services" class="summary-services"></div>
                    <div class="summary-line"><span>Time together</span><strong id="booking-duration">0 min</strong></div>
                    <div class="summary-line total"><span>Service total</span><strong id="booking-total">—</strong></div>
                    <p class="field-help">Pay at the studio. @if (config('studio.tax_percent'))
                            {{ config('studio.tax_percent') }}% tax is added on your invoice.@elseNo payment is taken when
                            booking.
                        @endif
                    </p><button class="button full" id="booking-submit">Confirm appointment
                        @include('components.icon', ['name' => 'arrow'])</button>
                    <p class="fine-print">Need to change plans? Contact the studio and we’ll find another time.</p>
                </aside>
            </div>
        </form>
    </div>
@endsection
