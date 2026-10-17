<?php

namespace App\Http\Controllers;

use Carbon\CarbonImmutable;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    /**
     * @param  Request  $request
     * @return View
     */
    public function index(Request $request): View
    {
        return view('notifications.index', [
            'notifications' => $request->user()->notifications()->reorder()->orderByDesc('created_at')->orderByDesc('id')->paginate(20),
        ]);
    }

    /**
     * @param  Request  $request
     * @return RedirectResponse
     */
    public function read(Request $request): RedirectResponse
    {
        $request->user()->unreadNotifications()->update(['read_at' => CarbonImmutable::now()]);

        return to_route('notifications')->with('toast', 'All notifications marked as read.');
    }
}
