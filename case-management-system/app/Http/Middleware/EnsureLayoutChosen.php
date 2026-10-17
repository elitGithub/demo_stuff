<?php

namespace App\Http\Middleware;

use App\Layouts\LayoutResolver;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureLayoutChosen
{
    /**
     * @param  Request  $request
     * @param  Closure  $next
     * @return Response
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (app(LayoutResolver::class)->fromRequest($request) === null) {
            $request->session()->put('layout.intended', $request->fullUrl());

            return to_route('layout.picker');
        }

        return $next($request);
    }
}
