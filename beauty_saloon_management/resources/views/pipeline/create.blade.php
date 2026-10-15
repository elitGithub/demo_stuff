@extends('layouts.app')
@section('title', 'New enquiry')
@section('content')
    <div class="page-heading"><div><a class="back-link" href="{{ route('pipeline.index') }}">← Enquiry pipeline</a><h1>Start a conversation</h1><p>Every enquiry starts as a lead. Add the client, organiser and next action.</p></div></div>
    <section class="panel">
        @if ($clients->isEmpty())<p>Add a client before creating their enquiry.</p><a class="button" href="{{ route('clients.index') }}">Open client directory</a>@else
            <form method="post" action="{{ route('pipeline.store') }}" class="form-grid">@csrf
                <label style="grid-column:1 / -1">Client<select name="client_id" required><option value="">Choose a client</option>@foreach ($clients as $client)<option value="{{ $client->id }}" @selected((int) old('client_id', request('client')) === $client->id)>{{ $client->name }}{{ $client->company ? ' · '.$client->company : '' }} · {{ strtoupper($client->segment) }}</option>@endforeach</select></label>
                @include('pipeline.form')
                <p class="field-help" style="grid-column:1 / -1">For a new contact, <a class="text-link" href="{{ route('clients.index') }}">add their client profile</a> first. Enquiries track planning; book actual appointments separately when times are agreed.</p>
                <div class="action-row" style="grid-column:1 / -1"><button class="button">Create enquiry</button><a class="button secondary" href="{{ route('pipeline.index') }}">Back to pipeline</a></div>
            </form>
        @endif
    </section>
@endsection
