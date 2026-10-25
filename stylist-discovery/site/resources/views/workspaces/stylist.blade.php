@component('layouts.app', ['title' => 'Your studio diary'])
    <section class="booking-heading"><p class="eyebrow">STYLIST PERSPECTIVE / {{ auth()->user()->name }}</p><h1>A considered <em>diary.</em></h1><p>Review requests, follow deposits and keep your studio day in view.</p><div class="workspace-studio-links"><a class="text-link" href="{{ route('stylist.availability.edit') }}">Availability →</a><a class="text-link" href="{{ route('stylist.onboarding') }}">Studio settings →</a></div></section>
    @include('workspaces.partials.appointments')
@endcomponent
