<x-app-layout :title="$job->title">
    <a class="back-link" href="{{ route('dashboard') }}">← Your workspace</a>
    <div class="page-heading"><div class="row-between"><p class="eyebrow">{{ $job->category->name }} · REQUEST #{{ $job->id }}</p><x-status-badge :status="$job->status" /></div><h1>{{ $job->title }}</h1><p class="icon-line"><x-icon name="pin" />{{ $job->service_area }}<span>·</span><x-icon name="calendar" />{{ $job->preferred_date->format('M j, Y') }}</p></div>
    <div class="detail-grid">
        <div class="stack">
            <article class="content-panel padded"><h2>The project</h2><p class="preserve-lines">{{ $job->description }}</p>
                @if($job->photos->isNotEmpty())<div class="request-photos">@foreach($job->photos as $photo)<a href="{{ route('photos.show', $photo) }}" target="_blank" rel="noopener"><img src="{{ route('photos.show', $photo) }}" alt="Photo of {{ $job->title }}" width="{{ $photo->width }}" height="{{ $photo->height }}"></a>@endforeach</div>@endif
                @if($showPrivate)<div class="private-details"><p class="eyebrow">PRIVATE JOB DETAILS</p><p>{{ $job->street_address }}, {{ $job->service_area }}</p><p>{{ $job->customer->email }}@if($job->customer->phone) · {{ $job->customer->phone }}@endif</p></div>@else<p class="field-hint">The exact address is shared after hiring.</p>@endif
            </article>
            @if(\Illuminate\Support\Facades\View::exists('quotes._list'))@include('quotes._list')@endif
            @if(\Illuminate\Support\Facades\View::exists('jobs._actions'))@include('jobs._actions')@endif
        </div>
        <aside class="stack"><article class="content-panel padded"><p class="eyebrow">PROJECT BUDGET</p><p class="price">{{ $job->budget_cents !== null ? \App\Support\Money::format($job->budget_cents) : 'Let’s talk' }}</p><p class="muted">A starting point for thoughtful proposals.</p>
                @if(auth()->id() === $job->customer_id && $job->status === \App\Enums\JobStatus::Open && $quotes->isEmpty())<a class="button secondary full" href="{{ route('requests.edit', $job) }}">Edit request</a>@endif
            </article>@if($showPrivate)<article class="content-panel padded"><h3>The story so far</h3><ol class="timeline">@foreach($job->events->sortByDesc('created_at') as $event)<li><strong>{{ $event->description }}</strong><small>{{ $event->created_at->timezone(config('marketplace.timezone'))->format('M j · g:i a') }}</small></li>@endforeach</ol></article>@endif
        </aside>
    </div>
</x-app-layout>
