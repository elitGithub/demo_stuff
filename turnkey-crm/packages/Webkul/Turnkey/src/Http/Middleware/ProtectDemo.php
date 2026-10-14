<?php

namespace Webkul\Turnkey\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Webkul\Turnkey\Support\DemoAccess;

class ProtectDemo
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('turnkey.demo')) {
            return $next($request);
        }

        $route = (string) $request->route()?->getName();
        if ($route === '' && $request->isMethod('GET') && $request->path() === trim(config('app.admin_path', 'admin'), '/')) {
            return redirect()->route('admin.session.create');
        }

        if (! DemoAccess::allows($route, count($request->allFiles()) > 0)) {
            abort(403, trans('turnkey::app.restricted'));
        }

        return $next($request);
    }
}
