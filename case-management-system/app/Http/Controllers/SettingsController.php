<?php

namespace App\Http\Controllers;

use App\Queries\TrackedSenderListQuery;
use Illuminate\Contracts\View\View;

class SettingsController extends Controller
{
    /**
     * @param  TrackedSenderListQuery  $senders
     * @return View
     */
    public function __invoke(TrackedSenderListQuery $senders): View
    {
        return view('settings.index', [
            'senders' => $senders->paginate(),
        ]);
    }
}
