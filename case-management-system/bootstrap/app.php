<?php

use App\Exceptions\OwnerNotFound;
use App\Exceptions\SandboxLimitReached;
use App\Http\Middleware\DemoControlsOnly;
use App\Http\Middleware\EnsureLayoutChosen;
use App\Http\Middleware\ShareWorkspaceLayout;
use App\Http\Middleware\UseSandboxDatabase;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->redirectGuestsTo('/sign-in');
        $middleware->redirectUsersTo('/');
        $middleware->web(prepend: [UseSandboxDatabase::class], append: [ShareWorkspaceLayout::class]);
        $middleware->alias(['demo' => DemoControlsOnly::class, 'layout.chosen' => EnsureLayoutChosen::class]);
        $middleware->prependToPriorityList(before: AuthenticatesRequests::class, prepend: UseSandboxDatabase::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->dontReport(SandboxLimitReached::class);
        $exceptions->render(
            fn (OwnerNotFound $exception) => redirect()
                ->route('sign-in')
                ->with('error', 'That Google account is not the owner of this Casefile.'),
        );
        $exceptions->render(
            fn (SandboxLimitReached $exception, Request $request) => $request->expectsJson()
                ? response()->json(['message' => $exception->getMessage()], 429, ['Retry-After' => $exception->retryAfterSeconds])
                : response()->view('errors.429', ['notice' => $exception->getMessage()], 429, ['Retry-After' => $exception->retryAfterSeconds]),
        );
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
