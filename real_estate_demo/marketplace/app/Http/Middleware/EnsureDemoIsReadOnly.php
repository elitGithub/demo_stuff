<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureDemoIsReadOnly
{
    public function handle(Request $request, Closure $next): Response
    {
        if (config('demo.read_only') && ! $request->isMethodSafe()) {
            $sessionAction = $request->isMethod('POST')
                && $request->routeIs('login.store', 'demo.login', 'logout');

            abort_unless($sessionAction, 403,
                'This shared demo is read-only. You can explore every role, but changes are disabled.');
        }

        return $next($request);
    }
}
