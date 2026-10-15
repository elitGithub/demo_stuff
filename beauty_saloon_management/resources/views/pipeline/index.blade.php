@extends('layouts.app')
@section('title', 'Enquiry pipeline')
@section('content')
    <div class="page-heading">
        <div><span class="eyebrow">FROM FIRST CALL TO FINAL DETAILS</span><h1>Enquiry pipeline</h1><p>Salon packages, celebrations and group bookings, with a clear next step.</p></div>
        <a class="button" href="{{ route('pipeline.create') }}">New enquiry</a>
    </div>
    <section class="panel mb">
        <form method="get" class="form-grid three">
            <label>Search<input name="q" value="{{ request('q') }}" maxlength="120" placeholder="Enquiry, client or company"></label>
            <label>Stage<select name="stage"><option value="">All stages</option>@foreach ($stages as $stage)<option value="{{ $stage }}" @selected(request('stage') === $stage)>{{ ucfirst($stage) }}</option>@endforeach</select></label>
            <label>Client segment<select name="segment"><option value="">All clients</option>@foreach (['b2c' => 'Individual · B2C', 'b2b' => 'Business · B2B', 'b2g' => 'Government · B2G'] as $value => $label)<option value="{{ $value }}" @selected(request('segment') === $value)>{{ $label }}</option>@endforeach</select></label>
            @if (auth()->user()->isManager())<label>Assigned to<select name="assigned_to"><option value="">All team members</option>@foreach ($agents as $agent)<option value="{{ $agent->id }}" @selected((string) request('assigned_to') === (string) $agent->id)>{{ $agent->name }}</option>@endforeach</select></label>@endif
            <label>Stage entered from<input type="date" name="from" value="{{ request('from') }}"></label>
            <label>Stage entered through<input type="date" name="to" value="{{ request('to') }}"></label>
            <label>Follow-up<select name="due"><option value="">Any date</option><option value="1" @selected(request('due') === '1')>Due now or overdue</option></select></label>
            <div class="action-row"><button class="button secondary">Apply filters</button><a class="text-link" href="{{ route('pipeline.index') }}">Reset</a></div>
        </form>
        <div class="action-row mt"><span class="muted">{{ $opportunities->total() }} enquiries{{ auth()->user()->isManager() ? '' : ' assigned to you' }} · {{ config('studio.timezone') }}</span><a class="text-link" href="{{ route('pipeline.export', request()->only(['q', 'stage', 'segment', 'assigned_to', 'due', 'from', 'to'])) }}">Export filtered CSV ↓</a></div>
    </section>
    @if ($opportunities->isEmpty())<section class="panel"><p class="empty">No enquiries match these filters. Add an enquiry or adjust your filters.</p></section>@else
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:18px;align-items:start">
            @foreach ($stages as $stage)
                @if (! request('stage') || request('stage') === $stage)
                    <section class="panel" aria-label="{{ ucfirst($stage) }} enquiries" style="padding:18px;min-width:0">
                        <div class="panel-heading"><h2>{{ ucfirst($stage) }}</h2><span class="count">{{ $counts[$stage] ?? 0 }}</span></div>
                        @forelse ($opportunities->where('stage', $stage) as $enquiry)
                            <a href="{{ route('pipeline.show', $enquiry) }}" class="block mt" style="border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:10px;padding:15px;overflow-wrap:anywhere">
                                <span class="eyebrow">{{ $enquiry->reference }}</span><h3>{{ $enquiry->title }}</h3><p class="muted">{{ $enquiry->client->name }}@if ($enquiry->client->company) · {{ $enquiry->client->company }}@endif</p>
                                <p>{{ \App\Models\Opportunity::KINDS[$enquiry->kind] }} · {{ $enquiry->guest_count }} {{ $enquiry->guest_count === 1 ? 'guest' : 'guests' }}</p>
                                @if ($enquiry->next_action)<p class="mt"><strong>Next:</strong> {{ $enquiry->next_action }}</p>@endif
                                @if ($enquiry->next_follow_up_at)<small class="block mt">{{ $enquiry->next_follow_up_at->isPast() ? 'Follow-up due' : 'Follow up' }} · {{ $enquiry->next_follow_up_at->setTimezone(config('studio.timezone'))->format('M j, H:i') }}</small>@endif
                                <small class="muted block mt">{{ $enquiry->assignedUser->name }}</small>
                            </a>
                        @empty <p class="muted">{{ ($counts[$stage] ?? 0) > 0 ? 'More enquiries on another page.' : 'No enquiries at this stage.' }}</p>@endforelse
                    </section>
                @endif
            @endforeach
        </div>
        @include('components.pagination', ['records' => $opportunities])
    @endif
@endsection
