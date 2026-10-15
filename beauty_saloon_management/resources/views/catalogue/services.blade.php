@extends('layouts.app')
@section('title', 'Services')
@section('content')<div class="page-heading">
        <div><span class="eyebrow">WHAT YOU DO BEST</span>
            <h1>A menu with intention.</h1>
            <p>Thoughtful services, clear prices, and the right time for every visit.</p>
        </div><button type="button" class="button" data-toggle="new-service">@include('components.icon', ['name' => 'plus']) Add service</button>
    </div>
    <section class="panel mb" id="new-service" hidden>
        <h2>A new reason to visit</h2>@include('catalogue.service-form', ['service' => null])
    </section>
    <div class="catalogue-grid">
        @foreach ($services as $service)
            <article class="panel">
                <div class="service-category">{{ $service->category }} <span
                        class="badge {{ $service->active ? 'confirmed' : 'cancelled' }}">{{ $service->active ? 'Available' : 'Archived' }}</span>
                </div>
                <h2 class="mt">{{ $service->name }}</h2>
                <p class="muted">{{ $service->description }}</p>
                <div class="service-metrics">
                    <strong>{{ \App\Support\Money::format($service->price) }}</strong><span>@include('components.icon', ['name' => 'clock'])
                        {{ $service->duration }} min</span></div>
                <p class="field-help">With
                    {{ $service->stylists->pluck('name')->implode(', ') ?: 'no stylists assigned yet' }}</p>
                <details class="edit-details">
                    <summary>Edit service <span>+</span></summary>
                    <div class="mt">@include('catalogue.service-form')</div>
                </details>
            </article>
        @endforeach
</div>@endsection
