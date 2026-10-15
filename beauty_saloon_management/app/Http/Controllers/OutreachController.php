<?php

namespace App\Http\Controllers;

use App\Models\MarketingMessage;
use App\Models\Subscriber;
use App\Services\OutreachService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\View\View;

class OutreachController extends Controller
{
    public function index(): View
    {
        Gate::authorize('manage-studio');

        return view('outreach.index', [
            'messages' => MarketingMessage::with(['client', 'subscriber'])->latest('id')->paginate(20),
            'subscribers' => Subscriber::latest('id')->paginate(15, ['*'], 'audience'),
            'audienceCount' => Subscriber::whereNull('unsubscribed_at')->count(),
            'pendingCount' => MarketingMessage::where('status', 'pending')->count(),
            'campaignKey' => (string) Str::uuid(),
        ]);
    }

    public function generate(OutreachService $outreach): RedirectResponse
    {
        Gate::authorize('manage-studio');
        $count = $outreach->generateDue();

        return back()->with('success', $count.' occasion previews created. No messages have been sent.');
    }

    public function process(OutreachService $outreach): RedirectResponse
    {
        Gate::authorize('manage-studio');
        $count = $outreach->processDue();

        return back()->with('success', $count.' messages simulated after a fresh consent check. Nothing was sent.');
    }

    public function newsletter(Request $request, OutreachService $outreach): RedirectResponse
    {
        Gate::authorize('manage-studio');
        $data = $request->validate(['subject' => 'required|string|max:160', 'body' => 'required|string|max:5000', 'campaign_key' => 'required|uuid']);
        $count = $outreach->previewNewsletter($data['subject'], $data['body'], $data['campaign_key']);

        return back()->with('success', $count.' newsletter previews created for the consenting audience.');
    }

    public function subscribe(Request $request): RedirectResponse
    {
        $data = $request->validate(['email' => 'required|email|max:200', 'consent' => 'required|accepted']);
        Subscriber::firstOrCreate(['email' => Str::lower(trim($data['email']))], ['consented_at' => now()]);

        return redirect()->route('home')->with('success', 'Thank you. Your newsletter preference has been recorded. Previously withdrawn subscriptions stay opted out.');
    }

    public function unsubscribeForm(string $token): View
    {
        $subscriber = Subscriber::where('unsubscribe_token', $token)->firstOrFail();

        return view('outreach.unsubscribe', ['token' => $token, 'unsubscribed' => (bool) $subscriber->unsubscribed_at]);
    }

    public function unsubscribe(string $token): View
    {
        $subscriber = Subscriber::where('unsubscribe_token', $token)->firstOrFail();
        $subscriber->update(['unsubscribed_at' => $subscriber->unsubscribed_at ?? now()]);
        MarketingMessage::where('subscriber_id', $subscriber->id)->where('status', 'pending')->update(['status' => 'cancelled', 'processed_at' => now()]);

        return view('outreach.unsubscribe', ['token' => $token, 'unsubscribed' => true]);
    }

    public function suppress(Subscriber $subscriber): RedirectResponse
    {
        Gate::authorize('manage-studio');
        $subscriber->update(['unsubscribed_at' => $subscriber->unsubscribed_at ?? now()]);
        MarketingMessage::where('subscriber_id', $subscriber->id)->where('status', 'pending')->update(['status' => 'cancelled', 'processed_at' => now()]);

        return back()->with('success', 'Subscriber opted out; pending newsletter previews cancelled.');
    }
}
