@extends('layouts.app')
@section('title', 'Memberships')
@section('content')
<div class="page-heading"><div><span class="eyebrow">A LITTLE CONTINUITY</span><h1>Care that continues.</h1><p>Clear membership terms, recorded payments, and a complete renewal history.</p></div><a class="button secondary" href="{{ route('retail.index') }}">Retail & stock</a></div>
<section class="panel mb"><h2>Enrol a client</h2><p class="muted">Each term is purchased once. Memberships do not renew or charge automatically.</p>
@if ($clients->isNotEmpty() && $plans->where('active', true)->isNotEmpty())
<form class="stack" method="post" action="{{ route('memberships.store') }}">@csrf
    <input type="hidden" name="idempotency_key" value="{{ old('idempotency_key', (string) \Illuminate\Support\Str::uuid()) }}">
    <div class="form-grid">
        <label>Client<select name="client_id" required><option value="">Choose a client</option>@foreach ($clients as $client)<option value="{{ $client->id }}" @selected(old('client_id') == $client->id)>{{ $client->name }}{{ $client->email ? ' · '.$client->email : '' }}</option>@endforeach</select></label>
        <label>Plan<select name="membership_plan_id" required><option value="">Choose a plan</option>@foreach ($plans->where('active', true) as $plan)<option value="{{ $plan->id }}" @selected(old('membership_plan_id') == $plan->id)>{{ $plan->name }} · {{ $plan->duration_days }} days · {{ \App\Support\Money::format($plan->price) }}</option>@endforeach</select></label>
        <label>Starts on<input type="date" name="starts_on" value="{{ old('starts_on', now(config('studio.timezone'))->toDateString()) }}" required></label>
        @include('commerce.payment-method')
    </div>
    <p class="field-help">{{ config('studio.tax_percent') }}% tax is added to the plan price. Payment is recorded locally; no card is charged.</p>
    <button class="button">Record paid membership</button>
</form>
@else<p class="muted">Add a plan and a client to record your first membership. <a href="{{ route('clients.index') }}">Open clients</a></p>@endif
</section>
<section class="panel mb"><details class="edit-details"><summary>Add a membership plan <span>+</span></summary><div class="mt">@include('commerce.plan-form', ['plan' => null])</div></details></section>
<div class="catalogue-grid mb">
@forelse ($plans as $plan)
<article class="panel"><div class="service-category">{{ $plan->duration_days }} DAY TERM <span class="badge {{ $plan->active ? 'confirmed' : 'cancelled' }}">{{ $plan->active ? 'Available' : 'Archived' }}</span></div><h2 class="mt">{{ $plan->name }}</h2><p class="muted" style="white-space: pre-line">{{ $plan->benefits }}</p><div class="service-metrics"><strong>{{ \App\Support\Money::format($plan->price) }}</strong><span>per term</span></div><details class="edit-details"><summary>Edit plan <span>+</span></summary><div class="mt">@include('commerce.plan-form')</div></details></article>
@empty<section class="panel"><p class="muted">No membership plans yet.</p></section>@endforelse
</div>
<section class="panel"><h2>Membership & renewal history</h2><p class="muted">The start date is included; the end date is the first day outside the term. Renewals begin when the current term ends, or today if it has expired.</p>
<div class="table-wrap"><table><thead><tr><th>Client & purchased plan</th><th>Term</th><th>Price</th><th>Status</th><th>Receipt & renewal</th></tr></thead><tbody>
@forelse ($memberships as $membership)
<tr><td><a href="{{ route('clients.show', $membership->client) }}"><strong>{{ $membership->client->name }}</strong></a><div>{{ $membership->plan_name }}</div><details><summary>Purchased benefits</summary><p style="white-space: pre-line">{{ $membership->benefits }}</p></details>@if ($membership->previous_membership_id)<small class="muted">Renewal of term #{{ $membership->previous_membership_id }}</small>@endif</td><td>{{ $membership->starts_on->format('M j, Y') }}<br><span class="muted">to {{ $membership->ends_on->format('M j, Y') }}</span><br><small>{{ $membership->duration_days }} days</small></td><td>{{ \App\Support\Money::format($membership->price, $membership->invoice->currency) }}</td><td><span class="badge">{{ $membership->status() }}</span></td><td><a href="{{ route('invoices.show', $membership->invoice) }}">{{ $membership->invoice->number }}</a>
@if ($membership->renewal)<p class="field-help">Renewed as term #{{ $membership->renewal->id }}</p>
@elseif ($membership->plan->active)
<details class="edit-details"><summary>Renew term <span>+</span></summary><form class="stack mt" method="post" action="{{ route('memberships.renew', $membership) }}">@csrf<input type="hidden" name="idempotency_key" value="{{ (string) \Illuminate\Support\Str::uuid() }}"><p class="field-help">Current plan: {{ $membership->plan->name }}, {{ $membership->plan->duration_days }} days at {{ \App\Support\Money::format($membership->plan->price) }} plus {{ config('studio.tax_percent') }}% tax.</p>@include('commerce.payment-method')<button class="button secondary small">Record paid renewal</button></form></details>
@else<p class="field-help">Plan archived</p>@endif
</td></tr>
@empty<tr><td colspan="5" class="muted">Purchased terms and renewals will appear here.</td></tr>@endforelse
</tbody></table></div>@include('components.pagination', ['records' => $memberships])</section>
@endsection
