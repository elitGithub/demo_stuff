<?php

namespace App\Http\Middleware;

use App\Enums\AccountRole;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureRole
{
    /**
     * @param  Request  $request
     * @param  Closure(Request): (Response)  $next
     * @param  string  $role
     * @return Response
     */
    public function handle(Request $request, Closure $next, string $role): Response
    {
        abort_unless($request->user()?->hasRole(AccountRole::from($role)), 403);

        return $next($request);
    }
}
