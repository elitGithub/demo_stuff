<?php

namespace App\Http\Controllers;

use App\Actions\Auth\SignInOwner;
use App\Contracts\SignInProvider;
use App\Enums\CasefileMode;
use App\Exceptions\OwnerNotFound;
use App\Exceptions\SandboxLimitReached;
use App\Sandbox\SandboxStore;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

class SignInController extends Controller
{
    /**
     * @return View
     */
    public function show(): View
    {
        return view('auth.sign-in');
    }

    /**
     * @param  Request  $request
     * @param  SignInProvider  $provider
     * @param  SignInOwner  $signInOwner
     * @param  SandboxStore  $sandboxes
     * @return RedirectResponse
     *
     * @throws OwnerNotFound
     * @throws SandboxLimitReached
     * @throws LockTimeoutException
     * @throws RuntimeException
     * @throws Throwable
     */
    public function google(Request $request, SignInProvider $provider, SignInOwner $signInOwner, SandboxStore $sandboxes): RedirectResponse
    {
        if (CasefileMode::current()->usesSandboxes()) {
            $sandboxes->start($request->session(), $request->ip());
        }

        $signInOwner($provider->authenticate());

        return redirect()->intended(route('home'));
    }

    /**
     * @param  Request  $request
     * @param  SandboxStore  $sandboxes
     * @return RedirectResponse
     *
     * @throws InvalidArgumentException
     * @throws RuntimeException
     */
    public function signOut(Request $request, SandboxStore $sandboxes): RedirectResponse
    {
        Auth::logout();

        if (CasefileMode::current()->usesSandboxes()) {
            $sandboxes->finish($request->session());
        }

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('sign-in');
    }
}
