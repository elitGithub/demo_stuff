@extends('layouts.app')
@section('title', 'Team')
@section('content')<div class="page-heading">
        <div><span class="eyebrow">GOOD HANDS, GREAT PEOPLE</span>
            <h1>Behind every good hair day.</h1>
            <p>Your team’s specialties, working hours and breathing room.</p>
        </div><button type="button" class="button" data-toggle="new-stylist">@include('components.icon', ['name' => 'plus']) Add team
            member</button>
    </div>
    <section class="panel mb" id="new-stylist" hidden>
        <h2>Meet someone new</h2>@include('catalogue.stylist-form', ['stylist' => null])
    </section>
    <div class="catalogue-grid">
        @foreach ($stylists as $stylist)
            <section class="panel">
                <div class="person"><span
                        class="avatar large tone-{{ $stylist->id % 4 }}">{{ collect(explode(' ', $stylist->name))->map(fn($s) => mb_substr($s, 0, 1))->implode('') }}</span>
                    <div>
                        <h2>{{ $stylist->name }}</h2><small>{{ $stylist->title }}</small>
                    </div><span class="tiny-dot {{ $stylist->active ? '' : 'inactive' }}"></span>
                </div>
                <p class="muted">{{ $stylist->bio }}</p>
                <div class="team-hours">@include('components.icon', ['name' => 'clock']) {{ $stylist->start_time }}–{{ $stylist->end_time }}
                    <small>{{ collect($stylist->working_days)->map(fn($d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][$d])->implode(' · ') }}</small>
                </div>
                <div class="tag-list">
                    @foreach ($stylist->services as $service)
                        <span>{{ $service->name }}</span>
                    @endforeach
                </div>
                <details class="edit-details">
                    <summary>Profile & working hours <span>+</span></summary>
                    <div class="mt">@include('catalogue.stylist-form')</div>
                </details>
                <details class="edit-details">
                    <summary>Block time off <span>+</span></summary>
                    <form class="stack mt" method="post" action="{{ route('team.time-off', $stylist) }}">
                        @csrf<label>Date<input type="date" name="date" required></label>
                        <div class="form-grid"><label>From<input type="time" name="start_time"
                                    required></label><label>Until<input type="time" name="end_time" required></label>
                        </div><label>Reason<input name="reason" maxlength="120"
                                placeholder="Break, training, a day to recharge…"></label><button
                            class="button secondary">Block this time</button>
                    </form>
                    @foreach ($stylist->timeOffs as $timeOff)
                        <p class="field-help">
                            {{ $timeOff->starts_at->setTimezone(config('studio.timezone'))->format('M j, H:i') }}–{{ $timeOff->ends_at->setTimezone(config('studio.timezone'))->format('H:i') }}
                            · {{ $timeOff->reason }}</p>
                        <form method="post" action="{{ route('team.time-off.remove', [$stylist, $timeOff]) }}"
                            data-confirm="Remove this time off and make the slots available again?">@csrf
                            @method('DELETE')<button class="button secondary small">Remove time off</button></form>
                    @endforeach
                </details>
            </section>
        @endforeach
</div>@endsection
