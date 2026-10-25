<?php

namespace App\Http\Controllers;

use App\Http\Requests\InboxReadRequest;
use App\Models\InboxMessage;
use App\Services\BookingService;
use App\Services\InboxService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class InboxController extends Controller
{
    /**
     * @param  Request  $request
     * @param  InboxService  $inbox
     * @param  BookingService  $bookings
     * @return View
     */
    public function index(Request $request, InboxService $inbox, BookingService $bookings): View
    {
        if ($request->isMethod('GET')) {
            $request->validate(['page' => ['sometimes', 'integer', 'min:1', 'max:10000'], 'appointments_page' => ['sometimes', 'integer', 'min:1', 'max:10000']]);
        }
        $actor = $request->user();
        $bookings->expireForActor($actor, CarbonImmutable::now('UTC'));

        return view('inbox.index', ['messages' => $inbox->messages($actor, $request->isMethod('GET') ? (int) $request->input('page', 1) : 1), 'appointmentsPage' => (int) $request->input('appointments_page', 1), 'unread' => InboxMessage::query()->ownedBy($actor->id)->whereNull('read_at')->count()]);
    }

    /**
     * @param  InboxReadRequest  $request
     * @param  InboxService  $inbox
     * @param  int  $message
     * @return RedirectResponse
     */
    public function read(InboxReadRequest $request, InboxService $inbox, int $message): RedirectResponse
    {
        $notification = InboxMessage::query()->ownedBy($request->user()->id)->findOrFail($message);
        $inbox->markRead($request->user(), $notification);

        return redirect()->to(route('inbox.index', ['page' => (int) $request->validated('page', 1), 'appointments_page' => (int) $request->validated('appointments_page', 1)]).'#message-'.$notification->id)->with('status', 'Message marked as read.');
    }
}
