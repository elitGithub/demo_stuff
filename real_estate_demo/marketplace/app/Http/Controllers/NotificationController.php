<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\View\View;

class NotificationController extends Controller
{
    public function index(Request $request): View
    {
        $filter = $request->validate(['filter' => ['nullable', 'in:all,unread,read']]);
        $notifications = $request->user()->notifications()
            ->when(($filter['filter'] ?? '') === 'unread', fn ($query) => $query->whereNull('read_at'))
            ->when(($filter['filter'] ?? '') === 'read', fn ($query) => $query->whereNotNull('read_at'))
            ->orderByDesc('created_at')->orderByDesc('id')->paginate(15)->withQueryString();

        return view('notifications.index', compact('notifications'));
    }

    public function read(Request $request, string $notification): RedirectResponse
    {
        $record = $request->user()->notifications()->findOrFail($notification);
        if ($record->read_at === null) {
            $record->markAsRead();
        }

        return to_route('notifications.index')->with('status', 'Notification marked as read.');
    }
}
