@extends('layouts.app')
@section('title', 'Studio settings')
@section('content')<div class="page-heading">
        <div><span class="eyebrow">THE DETAILS THAT MAKE IT YOURS</span>
            <h1>Your studio, connected.</h1>
            <p>A clear view of your business profile and integration readiness.</p>
        </div><a class="button secondary" href="{{ route('home') }}" target="_blank">Visit website ↗</a>
    </div>
    <div class="detail-grid">
        <section class="panel">
            <div class="panel-heading">
                <h2>Studio profile</h2><span class="badge confirmed">Configured</span>
            </div>
            @foreach (['Studio name' => config('studio.name'), 'Address' => config('studio.address'), 'Phone' => config('studio.phone'), 'Currency' => config('studio.currency'), 'Timezone' => config('studio.timezone'), 'Invoice tax rate' => config('studio.tax_percent') . '%'] as $key => $value)
                <div class="line-item"><span class="muted">{{ $key }}</span><strong>{{ $value }}</strong>
                </div>
            @endforeach
            <a class="text-link block mt" href="{{ route('content.edit') }}">Edit website & contact details →</a><p class="field-help mt">These details are set for this installation. They appear on your website, bookings and
                business documents.</p>
        </section>
        <section class="care-card"><span class="eyebrow">READY TO GROW WITH YOU</span>
            <h2>A strong start.<br><em>Room to grow.</em></h2>
            <p>One connected studio today. Your brand, your clients and your next chapter tomorrow.</p><a class="text-link"
                href="{{ route('dashboard') }}">Back to your day →</a>
        </section>
    </div>
    <div class="catalogue-grid mt">
        <section class="panel">
            <div class="panel-heading">
                <h2>Online payments</h2><span class="badge pending">Not connected</span>
            </div>
            <h3 class="integration-name">stripe<span>↗</span></h3>
            <p class="muted">The payment connection is prepared. Online collection needs a configured Stripe account and
                verified payment notifications before activation.</p>
            <div class="notice">You can record payments taken at the studio and generate receipts now.</div><a
                class="text-link" href="{{ route('invoices.index') }}">Manage invoices →</a>
        </section>
        <section class="panel">
            <div class="panel-heading">
                <h2>Client communications</h2><span class="badge pending">Preview mode</span>
            </div>
            <p class="muted">Email, SMS and WhatsApp reminder previews are available. Scheduling and delivery providers can
                be activated when the studio is ready to go live.</p>
            <div class="tag-list"><span>Email</span><span>SMS</span><span>WhatsApp</span></div><a class="text-link block mt"
                href="{{ route('reminders.index') }}">Review your outbox →</a>
        </section>
</div>@endsection
