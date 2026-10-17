<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\LoginRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

class SessionController extends Controller
{
    public function create(): View
    {
        return view('auth.login');
    }

    public function store(LoginRequest $request): RedirectResponse
    {
        $guard = Auth::guard();
        $readOnly = config('demo.read_only');
        $valid = $readOnly
            ? $guard->validate($request->only('email', 'password'))
            : $guard->attempt($request->only('email', 'password'), $request->boolean('remember'));

        if (! $valid) {
            throw ValidationException::withMessages(['email' => 'The email and password do not match.']);
        }

        if ($readOnly) {
            $guard->login($guard->getLastAttempted());
        }
        $request->session()->regenerate();

        return redirect()->intended(route('dashboard'));
    }

    public function destroy(Request $request): RedirectResponse
    {
        if (config('demo.read_only')) {
            Auth::guard()->logoutCurrentDevice();
        } else {
            Auth::logout();
        }
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return to_route('home');
    }
}
