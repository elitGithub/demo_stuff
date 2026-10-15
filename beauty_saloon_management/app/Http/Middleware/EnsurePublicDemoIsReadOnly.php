<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsurePublicDemoIsReadOnly
{
    /**
     * Handle an incoming request.
     *
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (config('studio.public_demo') && ! $request->isMethodSafe()) {
            $isSessionAction = $request->isMethod('POST')
                && $request->routeIs('login.store', 'login.demo', 'logout');

            abort_unless($isSessionAction, 403, 'This is a browse-only demo. Changes, bookings and message submissions are disabled to protect the shared sample data.');
        }

        return $next($request);
    }
}
