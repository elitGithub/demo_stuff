@extends('layouts.app')
@section('title', 'Invoices')
@section('content')<div class="page-heading">
        <div><span class="eyebrow">THE BUSINESS SIDE, BEAUTIFULLY SIMPLE</span>
            <h1>Every visit, accounted for.</h1>
            <p>Clear invoices. Recorded payments. A little less paperwork.</p>
        </div><a class="button secondary" href="{{ route('appointments.index') }}">Open appointments ↗</a>
    </div>
    <div class="stats-grid two">
        <article class="stat-card">
            <div><span>Payments recorded</span>@include('components.icon', ['name' => 'wallet'])</div>
            <strong>{{ \App\Support\Money::format($paid) }}</strong>
            <p>Paid invoices · all time</p>
        </article>
        <article class="stat-card">
            <div><span>Awaiting payment</span>@include('components.icon', ['name' => 'clock'])</div>
            <strong>{{ \App\Support\Money::format($outstanding) }}</strong>
            <p>Issued invoices · not yet recorded as paid</p>
        </article>
    </div>
    <section class="panel no-padding">
        <div class="panel-heading padded">
            <h2>Your invoices <span class="count">{{ $invoices->total() }}</span></h2><span class="muted">Create an invoice
                from a completed visit</span>
        </div>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>INVOICE</th>
                        <th>CLIENT</th>
                        <th>ISSUED</th>
                        <th>AMOUNT</th>
                        <th>STATUS</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    @forelse($invoices as $invoice)
                        <tr>
                            <td><a href="{{ route('invoices.show', $invoice) }}"><strong>{{ $invoice->number }}</strong></a>
                            </td>
                            <td>{{ $invoice->client_name }}</td>
                            <td>{{ $invoice->issued_at->format('M j, Y') }}</td>
                            <td><strong>{{ \App\Support\Money::format($invoice->total, $invoice->currency) }}</strong></td>
                            <td>@include('components.status', ['status' => $invoice->status])</td>
                            <td><a class="row-arrow" href="{{ route('invoices.show', $invoice) }}"
                                    aria-label="View invoice {{ $invoice->number }}">↗</a></td>
                    </tr>@empty<tr>
                            <td colspan="6" class="empty">Complete a visit, then generate its first invoice.</td>
                        </tr>
                    @endforelse
                </tbody>
            </table>
        </div>@include('components.pagination', ['records' => $invoices])
</section>@endsection
