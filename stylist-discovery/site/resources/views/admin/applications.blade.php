@component('layouts.app', ['title' => 'Studio reviews'])
    <section class="booking-heading"><p class="eyebrow">ADMIN / STUDIO REVIEWS</p><h1>A closer <em>look.</em></h1><p>Pending submissions appear first, followed by suspended and published studios.</p></section>
    @include('admin.navigation')
    <div class="studio-section-title"><h2>Studio profiles</h2><p>{{ $profiles->total() }} {{ $profiles->total() === 1 ? 'studio' : 'studios' }}</p></div>
    <div class="workspace-cards">@forelse($profiles as $profile)<article class="booking-panel workspace-card"><span class="specialty-tag">{{ $profile->status->label() }}</span><h3><a href="{{ route('admin.application', $profile->id) }}">{{ $profile->display_name }}</a></h3><p>{{ $profile->studio_name ?: 'Studio details in progress' }} · {{ config('demo.locations.'.$profile->city_code.'.city') }}</p><a class="text-link" href="{{ route('admin.application', $profile->id) }}">Review profile →</a></article>@empty<div class="booking-panel"><p>No studios to review yet.</p></div>@endforelse</div>
    <x-pagination :paginator="$profiles" label="Studio profiles" />
@endcomponent
