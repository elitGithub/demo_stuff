<?php

namespace App\Http\Middleware;

use App\Services\AccountService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureActorContext
{
    /**
     * @param  Request  $request
     * @param  Closure(Request): (Response)  $next
     * @return Response
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->isMethodSafe()) {
            $signedContext = $request->input('_actor_context');
            app(AccountService::class)->assertContext($request->session(), $request->user(), is_string($signedContext) && strlen($signedContext) <= 1024 ? $signedContext : '');
        }

        return $next($request);
    }
}
