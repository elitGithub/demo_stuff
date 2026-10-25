@component('layouts.app', ['title' => 'Specialty availability'])
    <section class="booking-heading"><p class="eyebrow">ADMIN / DISCOVERY</p><h1>A considered <em>catalogue.</em></h1><p>Unavailable specialties cannot receive new requests or accept pending ones. Accepted appointments keep their agreed terms.</p></section>
    @include('admin.navigation')
    <x-field-errors :errors="$errors" />
    <div class="studio-section-title"><h2>Specialties</h2><p>{{ $specialties->total() }} specialties</p></div>
    <div class="workspace-cards">@foreach($specialties as $specialty)<article class="booking-panel admin-specialty" id="specialty-{{ $specialty->id }}" tabindex="-1"><div><span class="specialty-tag">{{ $specialty->enabled ? 'Available' : 'Unavailable' }}</span><h2>{{ $specialty->name }}</h2></div>@if(session('changed_specialty') === $specialty->id)<x-status />@endif<form action="{{ route('admin.specialties.update', $specialty->id) }}" method="post" data-loading-form>@csrf<x-actor-context /><input type="hidden" name="enabled" value="{{ $specialty->enabled ? '0' : '1' }}"><x-loading-button :label="$specialty->enabled ? 'Make unavailable' : 'Make available'" progress="Saving availability…" /></form></article>@endforeach</div>
    <x-pagination :paginator="$specialties" label="Specialties" />
@endcomponent
