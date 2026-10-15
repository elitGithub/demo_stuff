<?php

namespace App\Http\Controllers;

use App\Models\Invoice;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReportController extends Controller
{
    /** @return array{0:Builder,1:string,2:string,3:string} */
    private function selection(Request $request): array
    {
        $data = $request->validate(['from' => 'nullable|date_format:Y-m-d', 'to' => 'nullable|date_format:Y-m-d|after_or_equal:from', 'currency' => 'nullable|string|regex:/^[A-Z]{3}$/']);
        $from = $data['from'] ?? now(config('studio.timezone'))->startOfMonth()->toDateString();
        $to = $data['to'] ?? now(config('studio.timezone'))->toDateString();
        $currency = $data['currency'] ?? config('studio.currency');
        $start = CarbonImmutable::parse($from, config('studio.timezone'))->startOfDay();
        $end = CarbonImmutable::parse($to, config('studio.timezone'))->addDay()->startOfDay();
        if ($end <= $start) {
            throw ValidationException::withMessages(['to' => 'The end date must be on or after the start date.']);
        }

        return [Invoice::where('status', 'paid')->where('currency', $currency)->where('paid_at', '>=', $start->utc())->where('paid_at', '<', $end->utc()), $from, $to, $currency];
    }

    public function index(Request $request): View
    {
        [$query, $from, $to, $currency] = $this->selection($request);
        $totals = (clone $query)->selectRaw('count(*) as sales, coalesce(sum(subtotal),0) as subtotal, coalesce(sum(tax),0) as tax, coalesce(sum(total),0) as total, coalesce(sum(commission_amount),0) as commission')->first();
        $kinds = (clone $query)->selectRaw('kind, count(*) as sales, sum(total) as total')->groupBy('kind')->get();
        $team = (clone $query)->whereNotNull('stylist_name')->selectRaw('stylist_id, stylist_name, count(*) as visits, sum(subtotal) as subtotal, sum(commission_amount) as commission')->groupBy('stylist_id', 'stylist_name')->orderByDesc('subtotal')->get();
        $items = DB::table('invoice_items')->whereIn('invoice_id', (clone $query)->select('id'))->selectRaw('name, sum(quantity) as quantity, sum(price * quantity) as revenue')->groupBy('name')->orderByDesc('revenue')->limit(20)->get();
        $invoices = (clone $query)->with('payment')->orderByDesc('paid_at')->paginate(20)->withQueryString();

        return view('workspace.reports', compact('totals', 'kinds', 'team', 'items', 'invoices', 'from', 'to', 'currency'));
    }

    public function export(Request $request): StreamedResponse
    {
        [$query] = $this->selection($request);

        return response()->streamDownload(function () use ($query) {
            $stream = fopen('php://output', 'w');
            fputcsv($stream, ['Invoice', 'Client', 'Type', 'Paid at', 'Currency', 'Subtotal (minor units)', 'Tax', 'Total', 'Stylist', 'Commission'], ',', '"', '');
            foreach ($query->orderBy('id')->cursor() as $invoice) {
                $row = [$invoice->number, $invoice->client_name, $invoice->kind, $invoice->paid_at->setTimezone(config('studio.timezone'))->toIso8601String(), $invoice->currency, $invoice->subtotal, $invoice->tax, $invoice->total, $invoice->stylist_name, $invoice->commission_amount];
                $row = array_map(fn ($value) => is_string($value) && preg_match('/^[\s]*[=+@\-\t\r\n]/u', $value) ? "'".$value : $value, $row);
                fputcsv($stream, $row, ',', '"', '');
            }
            fclose($stream);
        }, 'studio-sales.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }
}
