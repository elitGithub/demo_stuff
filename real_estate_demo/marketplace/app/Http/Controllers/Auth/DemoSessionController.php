<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Support\DemoActors;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class DemoSessionController extends Controller
{
    public function __invoke(Request $request, string $actor): RedirectResponse
    {
        abort_unless(config('demo.enabled')
            && (config('demo.read_only') || app()->environment(config('demo.environments')))
            && in_array($actor, config('demo.actors'), true), 404);

        $user = DemoActors::find($actor);
        Auth::login($user);
        $request->session()->regenerate();

        return to_route('dashboard')->with('status', 'You are exploring the '.$actor.' demo.');
    }
}
