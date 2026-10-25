@component('layouts.app', ['title' => 'Your appointments'])
    <section class="booking-heading"><p class="eyebrow">CLIENT PERSPECTIVE / {{ auth()->user()->name }}</p><h1>Your next <em>moment.</em></h1><p>Requests, deposits and appointments, together in one place.</p><a class="text-link" href="{{ route('discovery.index') }}">Find your next stylist →</a></section>
    @include('workspaces.partials.appointments')
@endcomponent
