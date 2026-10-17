<x-app-layout title="Demo receipt">
    <a class="back-link no-print" href="{{ route('requests.show', $payment->serviceRequest) }}">← Back to project</a>
    <article class="content-panel receipt padded">
        <div class="row-between"><a class="brand" href="{{ route('home') }}">haven<span class="brand-period">.</span></a><span class="simulation-pill">SIMULATED RECEIPT</span></div>
        <div class="receipt-heading"><p class="eyebrow">THANK YOU</p><h1>Home, taken care of.</h1><p class="notice">Simulated payment - no money was charged.</p></div>
        <dl class="receipt-meta"><div><dt>Receipt</dt><dd>{{ $payment->receipt_number }}</dd></div><div><dt>Issued</dt><dd>{{ $payment->paid_at->timezone(config('marketplace.timezone'))->format('F j, Y · g:i a') }}</dd></div><div><dt>Customer</dt><dd>{{ $payment->customer->name }}</dd></div><div><dt>Professional</dt><dd>{{ $payment->serviceRequest->acceptedQuote->provider->profile->business_name }}</dd></div></dl>
        <hr><div class="row-between"><div><strong>{{ $payment->serviceRequest->title }}</strong><p class="muted">Agreed residential service</p></div><strong>{{ \App\Support\Money::format($payment->amount_cents) }}</strong></div><hr><div class="row-between receipt-total"><span>Simulated total · {{ $payment->currency }}</span><strong>{{ \App\Support\Money::format($payment->amount_cents) }}</strong></div>
        <p class="field-hint">Purpose-built portfolio demonstration. This is not a tax invoice or proof of a real payment.</p>
        <button type="button" data-print class="button secondary no-print"><x-icon name="receipt" />Print receipt</button>
    </article>
</x-app-layout>
