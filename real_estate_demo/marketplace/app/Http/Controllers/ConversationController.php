<?php

namespace App\Http\Controllers;

use App\Models\Quote;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\View\View;

class ConversationController extends Controller
{
    public function index(Request $request): View
    {
        $id = $request->user()->id;
        $conversations = Quote::where(fn ($query) => $query->where('provider_id', $id)
            ->orWhereHas('serviceRequest', fn ($jobs) => $jobs->where('customer_id', $id)))
            ->with(['provider.profile', 'serviceRequest.customer', 'serviceRequest.category'])
            ->withMax('messages', 'created_at')->withCount('messages')
            ->orderByDesc('messages_max_created_at')->orderByDesc('id')->paginate(12);

        return view('messages.index', compact('conversations'));
    }

    public function show(Quote $quote): View
    {
        Gate::authorize('viewConversation', $quote);
        $quote->load(['provider.profile', 'serviceRequest.customer', 'serviceRequest.category']);
        $messages = $quote->messages()->with('sender')->orderByDesc('created_at')->orderByDesc('id')->paginate(30);

        return view('messages.show', [
            'quote' => $quote, 'messages' => $messages,
            'canSend' => Gate::allows('sendMessage', $quote),
        ]);
    }
}
