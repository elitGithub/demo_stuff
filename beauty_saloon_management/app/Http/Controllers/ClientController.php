<?php

namespace App\Http\Controllers;

use App\Models\Client;
use App\Models\Service;
use App\Models\Stylist;
use App\Services\ReminderService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\View\View;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ClientController extends Controller
{
    public function index(Request $request): View
    {
        $request->validate(['q' => 'nullable|string|max:120']);
        $clients = Client::withCount('appointments')->with('preferredStylist')->when($request->filled('q'), function ($query) use ($request) {
            $query->where(function ($search) use ($request) {
                $term = '%'.$request->string('q').'%';
                $search->where('name', 'like', $term)->orWhere('email', 'like', $term)->orWhere('phone', 'like', $term);
            });
        })->orderBy('name')->paginate(12)->withQueryString();

        return view('clients.index', compact('clients'));
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate(['name' => 'required|string|max:120', 'email' => 'nullable|email|max:200', 'phone' => 'nullable|string|max:30']);
        $client = Client::create($data + ['channels' => []]);

        return redirect()->route('clients.show', $client)->with('success', 'Client added.');
    }

    public function show(Client $client): View
    {
        return view('clients.show', [
            'client' => $client->load(['preferredStylist', 'notes.user', 'followUps', 'invoices', 'appointments' => fn ($query) => $query->with(['stylist', 'items'])->orderByDesc('starts_at')]),
            'services' => Service::where('active', true)->get(), 'stylists' => Stylist::where('active', true)->get(),
        ]);
    }

    public function update(Request $request, Client $client, ReminderService $reminders): RedirectResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:120', 'email' => 'nullable|email|max:200', 'phone' => 'nullable|string|max:30',
            'style_name' => 'nullable|string|max:120', 'style_notes' => 'nullable|string|max:3000',
            'style_photo' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:4096',
            'maintenance_weeks' => 'required|integer|min:1|max:52',
            'preferred_stylist_id' => 'nullable|integer|exists:stylists,id',
            'preferred_services' => 'nullable|array|max:10', 'preferred_services.*' => 'integer|distinct|exists:services,id',
            'channels' => 'nullable|array|max:3', 'channels.*' => 'in:email,sms,whatsapp|distinct',
            'birthday' => 'nullable|date_format:Y-m-d|before_or_equal:today', 'anniversary' => 'nullable|date_format:Y-m-d|before_or_equal:today',
            'marketing_channels' => 'nullable|array|max:3', 'marketing_channels.*' => 'in:email,sms,whatsapp|distinct',
            'segment' => 'sometimes|required|in:b2c,b2b,b2g', 'company' => 'nullable|string|max:160',
        ]);
        $data['channels'] = $data['channels'] ?? [];
        $data['marketing_channels'] = $data['marketing_channels'] ?? [];
        $data['preferred_services'] = array_map('intval', $data['preferred_services'] ?? []);
        $oldPhoto = $client->style_photo;
        unset($data['style_photo']);
        if ($request->hasFile('style_photo')) {
            $data['style_photo'] = $request->file('style_photo')->store('styles', 'local');
        }
        DB::transaction(function () use ($client, $data, $reminders) {
            $client->update($data);
            foreach ($client->appointments()->whereIn('status', ['booked', 'confirmed'])->where('starts_at', '>', now())->get() as $appointment) {
                $reminders->schedule($appointment, resetProcessed: false);
            }
        }, 5);
        if (isset($data['style_photo']) && $oldPhoto) {
            Storage::disk('local')->delete($oldPhoto);
        }

        return back()->with('success', 'Client preferences saved.');
    }

    public function photo(Client $client): StreamedResponse
    {
        abort_unless($client->style_photo && Storage::disk('local')->exists($client->style_photo), 404);

        return Storage::disk('local')->response($client->style_photo, null, ['X-Content-Type-Options' => 'nosniff']);
    }

    public function note(Request $request, Client $client): RedirectResponse
    {
        $data = $request->validate(['body' => 'required|string|max:3000']);
        $client->notes()->create($data + ['user_id' => $request->user()->id]);

        return back()->with('success', 'Note added to the client timeline.');
    }

    public function followUp(Request $request, Client $client): RedirectResponse
    {
        $data = $request->validate(['title' => 'required|string|max:200', 'due_date' => 'required|date_format:Y-m-d']);
        $client->followUps()->create($data);

        return back()->with('success', 'Follow-up scheduled.');
    }
}
