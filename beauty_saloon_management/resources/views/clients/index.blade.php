@extends('layouts.app')
@section('title', 'Clients')
@section('content')
    <div class="page-heading">
        <div><span class="eyebrow">RELATIONSHIPS, NOT JUST RECORDS</span>
            <h1>Your people.</h1>
            <p>Remember their style. Know their story. Make the next visit even better.</p>
        </div><button class="button" type="button" data-toggle="new-client">@include('components.icon', ['name' => 'plus']) New client</button>
    </div>
    <section class="panel mb" id="new-client" hidden>
        <h2>Make a new connection</h2>
        <form method="post" action="{{ route('clients.store') }}" class="form-grid three mt">@csrf<label>Full name<input
                    name="name" required maxlength="120" value="{{ old('name') }}"></label><label>Email<input
                    name="email" type="email" value="{{ old('email') }}"></label><label>Phone<input name="phone"
                    type="tel" maxlength="30" value="{{ old('phone') }}"></label><button class="button">Add
                client</button></form>
    </section>
    <section class="panel no-padding">
        <div class="panel-heading padded">
            <h2>Client directory <span class="count">{{ $clients->total() }}</span></h2>
            <form method="get" class="search-form"><label class="sr-only" for="client-search">Search
                    clients</label>@include('components.icon', ['name' => 'search'])<input id="client-search" name="q"
                    placeholder="Search name, email or phone" value="{{ request('q') }}"><button
                    class="button secondary small">Search</button></form>
        </div>
        <div class="client-grid">
            @forelse($clients as $client)
                <a class="client-card" href="{{ route('clients.show', $client) }}">
                    <div class="client-card-top"><span
                            class="avatar large tone-{{ $client->id % 4 }}">{{ $client->initials() }}</span><span
                            class="row-arrow">↗</span></div>
                    <h3>{{ $client->name }}</h3>
                    <p>{{ $client->email ?: 'No email added' }}</p>
                    <div class="client-style">@include('components.icon', ['name' => 'scissors'])
                        {{ $client->style_name ?: 'A style story to discover' }}</div>
                    <div class="client-card-bottom"><span>{{ $client->appointments_count }}
                            visits</span><span>{{ $client->preferredStylist?->name ?: 'Any stylist' }}</span></div>
            </a>@empty<div class="empty">No clients found. Try a different search or add a client.</div>
            @endforelse
        </div>@include('components.pagination', ['records' => $clients])
    </section>
@endsection
