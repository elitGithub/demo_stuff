<!DOCTYPE html>
<html>

<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: DejaVu Sans, sans-serif;
            color: #323130;
            font-size: 11px;
            line-height: 1.6;
            margin: 24px
        }

        h1 {
            font-family: DejaVu Serif, serif;
            font-weight: normal;
            font-size: 38px;
            margin: 0
        }

        h2 {
            font-size: 22px;
            font-weight: normal
        }

        .muted {
            color: #81807f
        }

        .top {
            border-bottom: 2px solid #5e5d5c;
            padding-bottom: 24px
        }

        .right {
            text-align: right
        }

        .label {
            font-size: 9px;
            letter-spacing: 2px;
            color: #81807f
        }

        table {
            width: 100%;
            border-collapse: collapse
        }

        th {
            text-align: left;
            font-size: 9px;
            letter-spacing: 1px;
            color: #81807f;
            background: #f4f3f2
        }

        th,
        td {
            padding: 14px 10px;
            border-bottom: 1px solid #e4e3e2
        }

        .address td {
            border: 0;
            padding: 25px 0
        }

        .total {
            font-size: 18px;
            background: #f4f3f2
        }

        .footer {
            margin-top: 70px;
            text-align: center;
            color: #81807f
        }

        .paid {
            color: #5e5d5c;
            font-size: 12px
        }
    </style>
</head>

<body>
    <div class="top">
        <table>
            <tr>
                <td style="border:0;padding:0">
                    <h1>{{ config('studio.name') }}</h1><span class="label">SALON & STUDIO</span>
                </td>
                <td class="right" style="border:0;padding:0">
                    <h2>{{ $receipt ? 'Receipt' : 'Invoice' }}</h2>
                    <strong>{{ $receipt ? $invoice->payment->reference : $invoice->number }}</strong><br>{{ $receipt ? $invoice->payment->recorded_at->format('F j, Y') : $invoice->issued_at->format('F j, Y') }}
                </td>
            </tr>
        </table>
    </div>
    <table class="address">
        <tr>
            <td><span
                    class="label">{{ $receipt ? 'RECEIVED FROM' : 'BILLED TO' }}</span><br><strong>{{ $invoice->client_name }}</strong><br>{{ $invoice->client_email }}
            </td>
            <td class="right"><span class="label">FROM THE
                    STUDIO</span><br>{{ config('studio.address') }}<br>{{ config('studio.phone') }}</td>
        </tr>
    </table>
    <table>
        <thead>
            <tr>
                <th>ITEM</th>
                <th>QTY</th>
                <th class="right">AMOUNT ({{ $invoice->currency }})</th>
            </tr>
        </thead>
        <tbody>
            @foreach ($invoice->items as $item)
                <tr>
                    <td>{{ $item->name }}</td>
                    <td>{{ $item->quantity }}</td>
                    <td class="right">{{ number_format($item->price * $item->quantity / 100, 2) }}</td>
                </tr>
            @endforeach
            <tr>
                <td colspan="2">Subtotal</td>
                <td class="right">{{ number_format($invoice->subtotal / 100, 2) }}</td>
            </tr>
            <tr>
                <td colspan="2">Tax ({{ $invoice->tax_percent }}%)</td>
                <td class="right">{{ number_format($invoice->tax / 100, 2) }}</td>
            </tr>
            <tr class="total">
                <td colspan="2">{{ $receipt ? 'Amount received' : 'Total' }}</td>
                <td class="right">{{ $invoice->currency }} {{ number_format($invoice->total / 100, 2) }}</td>
            </tr>
        </tbody>
    </table>
    @if ($receipt)
        <p class="paid">Paid in full · {{ ucfirst($invoice->payment->method) }} · Invoice {{ $invoice->number }}</p>
    @else<p class="muted">Status: {{ ucfirst($invoice->status) }}</p>
    @endif
    <div class="footer">
        Thank you for making time for yourself.<br>We look forward to your next visit.@if (config('studio.demo'))
            <p>DEMONSTRATION DOCUMENT · FICTIONAL SALON</p>
        @endif
    </div>
</body>

</html>
