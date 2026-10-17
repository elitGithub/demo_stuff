<?php

namespace App\Http\Controllers;

use App\Actions\Messages\SendMessage;
use App\Http\Requests\StoreMessageRequest;
use App\Models\Quote;
use Illuminate\Http\RedirectResponse;

class MessageController extends Controller
{
    public function __invoke(StoreMessageRequest $request, Quote $quote, SendMessage $send): RedirectResponse
    {
        $send->handle($request->user(), $quote, $request->validated('body'));

        return to_route('conversations.show', $quote)->with('status', 'Message sent.');
    }
}
