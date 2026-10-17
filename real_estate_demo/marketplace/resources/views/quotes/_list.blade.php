<div class="section-heading compact"><h2>{{ auth()->id() === $job->customer_id ? 'Find your good fit' : 'Proposals' }}</h2><span>{{ $quotes->count() }} {{ \Illuminate\Support\Str::plural('proposal', $quotes->count()) }}</span></div>
@foreach($quotes as $quote)@include('quotes.comparison')@endforeach
@if($quotes->isEmpty())
    @can('quote', $job)<article class="content-panel padded"><p class="eyebrow">BRING YOUR KNOW-HOW</p><h2>A thoughtful proposal starts here.</h2>@include('quotes.form')</article>
    @else<x-empty-state title="Good help takes a moment" description="Proposals will appear here when a professional responds." icon="chat" />
    @endcan
@endif
