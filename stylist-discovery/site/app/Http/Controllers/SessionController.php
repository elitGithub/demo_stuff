<?php

namespace App\Http\Controllers;

use App\Http\Requests\LoginRequest;
use App\Services\AccountService;
use Illuminate\Http\RedirectResponse;
use Illuminate\View\View;

class SessionController extends Controller
{
    /**
     * @return View
     */
    public function create(): View
    {
        return view('auth.login');
    }

    /**
     * @param  LoginRequest  $request
     * @param  AccountService  $accounts
     * @return RedirectResponse
     */
    public function store(LoginRequest $request, AccountService $accounts): RedirectResponse
    {
        $accounts->login($request->inputData());

        return redirect()->route('demo.ready')->with('status', 'You are signed in.');
    }

    /**
     * @param  AccountService  $accounts
     * @return RedirectResponse
     */
    public function destroy(AccountService $accounts): RedirectResponse
    {
        $accounts->logout();

        return redirect()->route('login')->with('status', 'You are signed out. Your private demo is still available.');
    }
}
