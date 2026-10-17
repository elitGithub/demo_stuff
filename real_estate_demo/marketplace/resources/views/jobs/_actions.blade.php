@php
    $isCustomer = auth()->id() === $job->customer_id;
    $isHired = auth()->id() === $job->acceptedQuote?->provider_id;
    $readOnly = config('demo.read_only');
    $canProgress = $isHired && auth()->user()->profile?->status === \App\Enums\ProviderStatus::Approved;
    $next = match ($job->status) {
        \App\Enums\JobStatus::Booked => $canProgress ? ['in_progress', 'Start work', 'Ready to get started? Let your customer know you’re on the job.'] : null,
        \App\Enums\JobStatus::InProgress => $canProgress ? ['awaiting_confirmation', 'Mark work as finished', 'Your customer will confirm the completed work.'] : null,
        \App\Enums\JobStatus::AwaitingConfirmation => $isCustomer ? ['completed', 'Confirm completion', 'Happy with the work? Confirm completion to unlock checkout and your review.'] : null,
        default => null,
    };
@endphp
@if($isCustomer || $isHired)
<article class="content-panel padded">
    <p class="eyebrow">WHAT’S NEXT</p>
    @if($next)
        <h2>{{ $next[1] }}</h2><p class="muted">{{ $next[2] }}</p>
        <form method="post" action="{{ route('jobs.status', $job) }}">@csrf<input type="hidden" name="status" value="{{ $next[0] }}"><button class="button primary" @disabled($readOnly)>{{ $next[1] }}<x-icon name="arrow" /></button></form>
    @elseif($job->status === \App\Enums\JobStatus::Completed)
        <h2>A job well done.</h2><p class="muted">This project is complete. Thank you for making home a little better.</p>
        @if($isCustomer)<div class="button-row">
            <a class="button primary" href="{{ $job->payment ? route('payments.show', $job->payment) : route('payments.create', $job) }}">{{ $job->payment ? 'View demo receipt' : 'Try simulated checkout' }}<x-icon name="arrow" /></a>
            @if(!$job->review)<a class="button secondary" href="{{ route('reviews.create', $job) }}">Leave a review</a>@endif
        </div>@elseif($isHired && $job->payment)<a class="button secondary" href="{{ route('payments.show', $job->payment) }}">View demo receipt</a>@endif
        @if($job->review)<div class="review-card"><span class="stars" aria-label="{{ $job->review->rating }} out of 5 stars">{{ str_repeat('★', $job->review->rating) }}</span><p>{{ $job->review->body }}</p></div>@endif
    @elseif($job->status === \App\Enums\JobStatus::Cancelled)
        <h2>Request cancelled</h2><p class="muted">Proposals and conversations remain here for reference. Checkout and reviews are unavailable.</p>
    @elseif($isHired && !$canProgress)
        <h2>Progress updates are unavailable</h2><p class="muted">Your provider profile must be approved to update this job.</p>
    @else
        <h2>{{ match ($job->status) {
            \App\Enums\JobStatus::Open => 'Your next chapter starts with a proposal.',
            \App\Enums\JobStatus::Booked => 'Your professional is booked.',
            \App\Enums\JobStatus::InProgress => 'Good things are happening.',
            default => 'Waiting for the customer’s confirmation.',
        } }}</h2><p class="muted">We’ll keep you updated here as your project moves forward.</p>
    @endif
    @if($isCustomer && in_array($job->status, [\App\Enums\JobStatus::Open, \App\Enums\JobStatus::Booked], true))
        <details class="cancel-details"><summary>Need to cancel this request?</summary><p class="muted">Cancelling closes the request and notifies professionals with active proposals. This cannot be undone.</p><form method="post" action="{{ route('jobs.cancel', $job) }}">@csrf<button class="button danger" @disabled($readOnly)>Cancel request</button></form></details>
    @endif
</article>
@endif
