<?php

namespace App\Http\Middleware;

use App\Layouts\LayoutResolver;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\View;
use Symfony\Component\HttpFoundation\Response;

class ShareWorkspaceLayout
{
    /**
     * @param  Request  $request
     * @param  Closure  $next
     * @return Response
     */
    public function handle(Request $request, Closure $next): Response
    {
        View::share('layout', app(LayoutResolver::class)->fromRequest($request));

        return $next($request);
    }
}
