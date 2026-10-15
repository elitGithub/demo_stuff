<?php

namespace App\Http\Controllers;

use App\Models\Appointment;
use App\Models\Invoice;
use App\Services\BillingService;
use Barryvdh\DomPDF\Facade\Pdf;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\View\View;

class InvoiceController extends Controller
{
    public function index(): View
    {
        return view('invoices.index', ['invoices' => Invoice::orderByDesc('issued_at')->orderByDesc('id')->paginate(15), 'paid' => Invoice::where('status', 'paid')->sum('total'), 'outstanding' => Invoice::where('status', 'unpaid')->sum('total')]);
    }

    public function issue(Appointment $appointment, BillingService $billing): RedirectResponse
    {
        return redirect()->route('invoices.show', $billing->issue($appointment))->with('success', 'Invoice ready.');
    }

    public function show(Invoice $invoice): View
    {
        return view('invoices.show', ['invoice' => $invoice->load(['items', 'payment', 'appointment.stylist'])]);
    }

    public function pay(Request $request, Invoice $invoice, BillingService $billing): RedirectResponse
    {
        $data = $request->validate(['method' => 'required|in:cash,card,transfer']);
        $billing->pay($invoice, $data['method']);

        return back()->with('success', 'Payment recorded. The receipt is ready to download.');
    }

    public function pdf(Request $request, Invoice $invoice): Response
    {
        $receipt = $request->routeIs('invoices.receipt');
        abort_if($receipt && $invoice->status !== 'paid', 404);
        $invoice->load(['items', 'payment']);

        return Pdf::loadView('invoices.document', compact('invoice', 'receipt'))->setPaper('a4')->download(($receipt ? $invoice->payment->reference : $invoice->number).'.pdf');
    }
}
