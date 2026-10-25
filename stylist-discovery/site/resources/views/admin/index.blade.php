@component('layouts.app', ['title' => 'Admin workspace'])
    <section class="booking-heading"><p class="eyebrow">ADMIN PERSPECTIVE</p><h1>Good studios.<br><em>Thoughtfully reviewed.</em></h1><p>Review submissions, manage discovery and follow appointments across the demo.</p></section>
    @include('admin.navigation')
    <x-status />
    <section class="admin-next booking-panel"><div><p class="eyebrow">START HERE</p><h2>{{ $pendingCount ? 'A studio is ready for review.' : 'Your review queue is clear.' }}</h2><p>{{ $pendingCount ? 'Check the profile, services and hours, then publish the studio.' : 'Browse studio profiles or explore how specialty availability shapes discovery.' }}</p></div><a class="compact-button" href="{{ $nextProfile ? route('admin.application', $nextProfile->id) : route('admin.applications') }}">{{ $nextProfile ? 'Review '.$nextProfile->display_name : 'Browse studios' }} →</a></section>
    <div class="setup-grid admin-summary">
        <article class="setup-card"><p class="eyebrow">STUDIO REVIEWS</p><strong class="admin-count">{{ $pendingCount }}</strong><h2>Awaiting a decision</h2><p>{{ $publishedCount }} published · {{ $suspendedCount }} suspended</p><a class="text-link" href="{{ route('admin.applications') }}">Review studios →</a></article>
        <article class="setup-card"><p class="eyebrow">APPOINTMENTS</p><strong class="admin-count">{{ $bookingCount }}</strong><h2>Across the demo</h2><p>Follow requests, deposits and completed visits.</p><a class="text-link" href="{{ route('admin.bookings') }}">View appointments →</a></article>
        <article class="setup-card"><p class="eyebrow">DISCOVERY</p><strong class="admin-count">{{ $enabledCount }}</strong><h2>Available specialties</h2><p>Control which specialties accept new bookings.</p><a class="text-link" href="{{ route('admin.specialties') }}">Manage specialties →</a></article>
    </div>
@endcomponent
