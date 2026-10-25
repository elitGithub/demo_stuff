@if(session('status'))<p class="success-notice" role="status">{{ session('status') }}</p>@endif
<x-field-errors :errors="$errors" />
<nav class="workspace-states" aria-label="Current appointment summary">
    @foreach([\App\Enums\BookingStatus::Requested, \App\Enums\BookingStatus::AwaitingDeposit, \App\Enums\BookingStatus::Confirmed] as $state)<a href="{{ route('workspace.index', ['status' => $state->value]) }}" @if($status === $state && !$date) aria-current="page" @endif><span>{{ $state === \App\Enums\BookingStatus::AwaitingDeposit ? 'Deposit due' : $state->label() }}</span><strong>{{ $counts->get($state->value) }}</strong></a>@endforeach
</nav>
<details class="workspace-filter-disclosure" @if($status || $date) open @endif><summary>Filter diary <span>{{ $counts->sum() }} total appointments</span></summary>
<form class="workspace-filters booking-panel" method="get" action="{{ route('workspace.index') }}" data-loading-form>
    <div class="form-field"><label for="workspace-status">Appointment status</label><select id="workspace-status" name="status"><option value="">All appointments</option>@foreach(\App\Enums\BookingStatus::cases() as $state)<option value="{{ $state->value }}" @selected($status === $state)>{{ $state->label() }}</option>@endforeach</select></div>
    <div class="form-field"><label for="workspace-date">Studio date <span class="field-optional">(optional)</span></label><input id="workspace-date" type="date" name="date" value="{{ $date }}"><span class="field-help">Uses each appointment’s studio timezone.</span></div>
    <x-loading-button label="Show appointments" progress="Updating your diary…" />
</form>
</details>
<section class="workspace-results"><div class="inbox-message-heading"><h2>{{ $date ? 'Studio diary · '.\Carbon\CarbonImmutable::parse($date)->format('d M Y') : ($status ? $status->label().' appointments' : 'Your appointments') }}</h2><span>{{ $appointments->total() }} {{ $appointments->total() === 1 ? 'appointment' : 'appointments' }}</span></div>
    <div class="workspace-cards">@forelse($appointments as $appointment)<x-booking-card :booking="$appointment" :now="$now" />@empty<div class="booking-panel workspace-empty"><h3>A little room in the diary.</h3><p>No appointments match this view.</p><a class="text-link" href="{{ route('workspace.index') }}">See all appointments →</a></div>@endforelse</div>
    <x-pagination :paginator="$appointments" label="Appointments" />
</section>
