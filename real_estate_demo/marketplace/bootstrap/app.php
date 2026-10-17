<?php

use App\Exceptions\WorkflowConflict;
use App\Http\Middleware\EnsureDemoIsReadOnly;
use App\Http\Middleware\EnsureRole;
use App\Models\Quote;
use App\Models\ServiceRequest;
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
        $middleware->alias(['role' => EnsureRole::class]);
        $middleware->web(append: [EnsureDemoIsReadOnly::class]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (WorkflowConflict $exception, Request $request) {
            if ($request->expectsJson()) {
                return response()->json(['message' => $exception->getMessage()], 409);
            }
            $job = $request->route('serviceRequest');
            $quote = $request->route('quote');
            $jobId = $job instanceof ServiceRequest ? $job->id
                : ($quote instanceof Quote ? $quote->service_request_id : null);

            return response()->view('errors.409', [
                'message' => $exception->getMessage(),
                'reloadUrl' => $jobId ? route('requests.show', $jobId) : route('dashboard'),
            ], 409);
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
