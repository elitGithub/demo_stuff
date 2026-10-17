<?php

namespace App\Http\Controllers;

use App\Actions\Payments\SimulatePayment;
use App\Http\Requests\StorePaymentRequest;
use App\Models\Payment;
use App\Models\ServiceRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Gate;
use Illuminate\View\View;

class PaymentController extends Controller
{
    public function create(ServiceRequest $serviceRequest, SimulatePayment $payment): View|RedirectResponse
    {
        Gate::authorize('create', [Payment::class, $serviceRequest]);
        $payment->ensureReady($serviceRequest);
        if ($serviceRequest->payment) {
            return to_route('payments.show', $serviceRequest->payment);
        }

        return view('payments.checkout', ['job' => $serviceRequest->load('acceptedQuote.provider.profile')]);
    }

    public function store(StorePaymentRequest $request, ServiceRequest $serviceRequest, SimulatePayment $payment): RedirectResponse
    {
        return to_route('payments.show', $payment->handle($request->user(), $serviceRequest));
    }

    public function show(Payment $payment): View
    {
        Gate::authorize('view', $payment);

        return view('payments.receipt', ['payment' => $payment->load('serviceRequest.acceptedQuote.provider.profile', 'customer')]);
    }
}
