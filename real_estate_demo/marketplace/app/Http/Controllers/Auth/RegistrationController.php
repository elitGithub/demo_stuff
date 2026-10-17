<?php

namespace App\Http\Controllers\Auth;

use App\Actions\Accounts\RegisterAccount;
use App\Http\Controllers\Controller;
use App\Http\Requests\RegisterAccountRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\View\View;

class RegistrationController extends Controller
{
    public function create(): View
    {
        return view('auth.register');
    }

    public function store(RegisterAccountRequest $request, RegisterAccount $register): RedirectResponse
    {
        $user = $register->handle($request->validated());
        Auth::login($user);
        $request->session()->regenerate();

        return to_route('dashboard');
    }
}
