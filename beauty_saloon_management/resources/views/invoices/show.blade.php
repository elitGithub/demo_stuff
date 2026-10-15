@extends('layouts.app')
@section('title', 'Invoice details')
@section('content')<div class="page-heading">
        <div><a class="back-link" href="{{ route('invoices.index') }}">← All invoices</a>
            <h1>{{ $invoice->number }}</h1>
            <p>Issued {{ $invoice->issued_at->format('F j, Y') }} · {{ $invoice->client_name }}</p>
        </div>
        <div class="action-row"><a class="button secondary"
                href="{{ route('invoices.pdf', $invoice) }}">@include('components.icon', ['name' => 'download']) Invoice PDF</a>
            @if ($invoice->status === 'paid')
                <a class="button" href="{{ route('invoices.receipt', $invoice) }}">@include('components.icon', ['name' => 'download']) Receipt PDF</a>
            @endif
        </div>
    </div>
    <div class="detail-grid">
        <section class="panel invoice-paper">
            <div class="spread"><a class="brand" href="{{ route('home') }}">{{ config('studio.name') }}<span>SALON &
                        STUDIO</span></a>@include('components.status', ['status' => $invoice->status])</div>
            <div class="invoice-address">
                <div><span class="eyebrow">BILLED TO</span>
                    <h3>{{ $invoice->client_name }}</h3>
                    <p>{{ $invoice->client_email }}</p>
                </div>
                <div><span class="eyebrow">FROM THE STUDIO</span>
                    <p>{{ config('studio.address') }}<br>{{ config('studio.phone') }}</p>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>ITEM</th>
                        <th>QTY</th>
                        <th class="align-right">AMOUNT</th>
                    </tr>
                </thead>
                <tbody>
                    @foreach ($invoice->items as $item)
                        <tr>
                            <td>{{ $item->name }}</td>
                            <td>{{ $item->quantity }}</td>
                            <td class="align-right">{{ \App\Support\Money::format($item->price * $item->quantity, $invoice->currency) }}</td>
                        </tr>
                    @endforeach
                </tbody>
            </table>
            <div class="invoice-totals">
                <div class="summary-line">
                    <span>Subtotal</span><strong>{{ \App\Support\Money::format($invoice->subtotal, $invoice->currency) }}</strong>
                </div>
                <div class="summary-line"><span>Tax
                        ({{ $invoice->tax_percent }}%)</span><strong>{{ \App\Support\Money::format($invoice->tax, $invoice->currency) }}</strong>
                </div>
                <div class="summary-line total">
                    <span>Total</span><strong>{{ \App\Support\Money::format($invoice->total, $invoice->currency) }}</strong>
                </div>
            </div>
            <div class="invoice-thanks">Thank you for making time for yourself.<small>We look forward to your next
                    visit.</small></div>
        </section>
        <aside class="stack">
            <section class="panel">
                <h2>{{ $invoice->status === 'paid' ? 'All taken care of.' : 'Record a payment' }}</h2>
                @if ($invoice->payment)
                    <div class="confirmation-check small-check">@include('components.icon', ['name' => 'check'])</div>
                    <p>Paid by <strong>{{ ucfirst($invoice->payment->method) }}</strong></p>
                    <p class="muted">
                        {{ $invoice->payment->recorded_at->setTimezone(config('studio.timezone'))->format('M j, Y · H:i') }}
                    </p>
                    <div class="line-item"><span>Receipt</span><strong>{{ $invoice->payment->reference }}</strong></div>
                @else<p class="muted">Record a payment already taken at the studio. This does not charge a card online.
                    </p>
                    <form class="stack" method="post" action="{{ route('invoices.pay', $invoice) }}"
                        data-confirm="Record this invoice as fully paid? Only continue if payment has been received.">
                        @csrf<label>Payment method<select name="method" required>
                                <option value="cash">Cash</option>
                                <option value="card">Card — paid at studio</option>
                                <option value="transfer">Bank transfer</option>
                            </select></label><button class="button full">Record
                            {{ \App\Support\Money::format($invoice->total, $invoice->currency) }} payment</button></form>
                @endif
            </section>
            @if ($invoice->appointment)<section class="panel"><span class="eyebrow">THE VISIT</span>
                <h3>{{ $invoice->appointment->items->pluck('name')->implode(' + ') }}</h3>
                <p class="muted">{{ $invoice->appointment->localStart()->format('M j, Y · H:i') }}<br>With
                    {{ $invoice->appointment->stylist->name }}</p><a class="text-link"
                    href="{{ route('appointments.show', $invoice->appointment) }}">Open appointment ↗</a>
            </section>@else<section class="panel"><span class="eyebrow">{{ strtoupper($invoice->kind) }}</span><p>Purchased at the studio.</p></section>@endif
        </aside>
</div>@endsection
