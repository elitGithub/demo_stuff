<?php

namespace App\Http\Controllers;

use App\Enums\AccountRole;
use App\Http\Requests\EnterDemoRequest;
use App\Services\AccountService;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

class DemoEntryController extends Controller
{
    /**
     * @param  EnterDemoRequest  $request
     * @return RedirectResponse
     */
    public function enter(EnterDemoRequest $request): RedirectResponse
    {
        if (! Auth::check()) {
            app(AccountService::class)->switchRole(AccountRole::Client);
        }

        return redirect()->route('demo.ready');
    }

    /**
     * @param  Request  $request
     * @return RedirectResponse|View
     */
    public function start(Request $request): RedirectResponse|View
    {
        if (! app(SandboxService::class)->restartExpiredSession($request->session(), CarbonImmutable::now())) {
            return redirect()->route('demo.ready');
        }

        return view('landing');
    }
}
