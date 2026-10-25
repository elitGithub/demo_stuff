@component('layouts.app', ['title' => 'Your service menu'])
    <a class="back-link" href="{{ route('stylist.onboarding') }}">← Your studio checklist</a>
    <section class="studio-menu-heading"><div><p class="eyebrow">02 / YOUR SERVICE MENU</p><h1>Good style.<br><em>Clearly priced.</em></h1><p>Give every appointment a name, a price and room in your day.</p></div><a class="button" href="{{ route('stylist.services.create') }}">Add a service <span aria-hidden="true">+</span></a></section>
    <x-status />
    <div class="studio-menu-summary"><p>{{ $services->total() }} {{ $services->total() === 1 ? 'service' : 'services' }} in your menu · {{ $profile->deposit_percent }}% deposit on new requests</p><a class="text-link" href="{{ route('stylist.availability.edit') }}">Next: your availability <span aria-hidden="true">→</span></a></div>
    <div class="studio-service-list">
        @forelse($services as $service)
            <article class="studio-service-row"><div><span class="specialty-tag">{{ $service->specialty->name }}</span><h2>{{ $service->name }}</h2><p>{{ $service->duration_minutes }} minutes · {{ $service->active ? ($service->specialty->enabled ? 'Available to clients' : 'Specialty unavailable') : 'Inactive · kept in your menu' }}</p></div><div class="studio-service-price"><strong>€{{ number_format($service->price_cents / 100, 2) }}</strong><a class="compact-button" href="{{ route('stylist.services.edit', $service->id) }}">Edit service</a></div></article>
        @empty
            <div class="studio-empty"><span class="card-number">A menu of possibilities</span><h2>Start with your signature.</h2><p>Add your first service so clients can find the appointment that feels right. Choose your specialties in your profile first.</p><a class="text-link" href="{{ route('stylist.profile.edit') }}">Check your specialties <span aria-hidden="true">→</span></a></div>
        @endforelse
    </div>
    <x-pagination :paginator="$services" label="Your services" />
@endcomponent
