<?php

namespace App\Http\Controllers;

use App\Enums\AccountRole;
use App\Http\Requests\RegistrationRequest;
use App\Services\AccountService;
use Illuminate\Http\RedirectResponse;
use Illuminate\View\View;

class RegistrationController extends Controller
{
    /**
     * @return View
     */
    public function create(): View
    {
        return view('auth.register');
    }

    /**
     * @param  RegistrationRequest  $request
     * @param  AccountService  $accounts
     * @return RedirectResponse
     */
    public function store(RegistrationRequest $request, AccountService $accounts): RedirectResponse
    {
        $user = $accounts->register($request->inputData());

        return redirect()->route($user->hasRole(AccountRole::Stylist) ? 'stylist.onboarding' : 'demo.ready')->with('status', 'Your demo account is ready.');
    }
}
