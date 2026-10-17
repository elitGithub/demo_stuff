<?php

namespace App\Http\Controllers;

use App\Actions\Quotes\AcceptQuote;
use App\Actions\Quotes\SubmitQuote;
use App\Actions\Quotes\UpdateQuote;
use App\Http\Requests\AcceptQuoteRequest;
use App\Http\Requests\StoreQuoteRequest;
use App\Http\Requests\UpdateQuoteRequest;
use App\Models\Quote;
use App\Models\ServiceRequest;
use Illuminate\Http\RedirectResponse;

class QuoteController extends Controller
{
    public function store(StoreQuoteRequest $request, ServiceRequest $serviceRequest, SubmitQuote $submit): RedirectResponse
    {
        $submit->handle($request->user(), $serviceRequest, $request->validated());

        return to_route('requests.show', $serviceRequest)->with('status', 'Your proposal is on its way.');
    }

    public function update(UpdateQuoteRequest $request, Quote $quote, UpdateQuote $update): RedirectResponse
    {
        $current = $update->handle($request->user(), $quote, $request->validated());

        return to_route('requests.show', $current->service_request_id)->with('status', 'Your proposal has been updated.');
    }

    public function accept(AcceptQuoteRequest $request, Quote $quote, AcceptQuote $accept): RedirectResponse
    {
        $job = $accept->handle($request->user(), $quote, (int) $request->validated('version'));

        return to_route('requests.show', $job)->with('status', 'It’s a match. Your project is booked.');
    }
}
