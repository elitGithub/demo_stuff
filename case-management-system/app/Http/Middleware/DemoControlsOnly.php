<?php

namespace App\Http\Middleware;

use App\Enums\CasefileMode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class DemoControlsOnly
{
    /**
     * @param  Request  $request
     * @param  Closure(Request): (Response)  $next
     * @return Response
     */
    public function handle(Request $request, Closure $next): Response
    {
        abort_unless(CasefileMode::current()->demoControlsEnabled(), 404);

        return $next($request);
    }
}
