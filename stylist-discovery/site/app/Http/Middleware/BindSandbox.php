<?php

namespace App\Http\Middleware;

use App\Data\SandboxContext;
use App\Enums\SandboxStatus;
use App\Models\Registry\Sandbox;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Closure;
use ErrorException;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Exception\HttpException;

class BindSandbox
{
    /**
     * @param  Request  $request
     * @param  Closure  $next
     * @return Response
     */
    public function handle(Request $request, Closure $next): Response
    {
        $original = config('database.connections.visitor');
        try {
            if ($request->routeIs('demo.enter') && ! $request->session()->has('sandbox_token')) {
                app(PreventRequestForgery::class)->handle($request, fn (): Response => new Response);
            }
            $service = app(SandboxService::class);
            $context = $request->routeIs('demo.enter')
                ? $service->enter($request->session(), (string) $request->server('REMOTE_ADDR'), CarbonImmutable::now())
                : $service->admit($request->session(), CarbonImmutable::now());
            app()->instance(SandboxContext::class, $context);
            Auth::forgetGuards();

            return DB::connection('visitor')->transaction(function () use ($request, $next, $context): Response {
                DB::connection('visitor')->table('sandbox_meta')->where('id', 1)->increment('access_lock_version');
                if (! Sandbox::query()->whereKey($context->digest)->where('generation', $context->generation)->where('status', SandboxStatus::Active)->exists()) {
                    throw new HttpException(410, 'This demo session has expired.');
                }
                if (DB::connection('visitor')->table('sandbox_meta')->where('id', 1)->value('generation') !== $context->generation) {
                    throw new RuntimeException('Visitor generation does not match its registry owner.');
                }
                $response = $next($request);
                if ($response instanceof StreamedResponse || $response instanceof BinaryFileResponse) {
                    throw new RuntimeException('Sandbox responses must be constructed synchronously.');
                }

                return $response;
            });
        } catch (QueryException|RuntimeException|ErrorException $exception) {
            if ($exception instanceof HttpException) {
                throw $exception;
            }
            throw app(SandboxService::class)->storageException($exception);
        } finally {
            DB::purge('visitor');
            config(['database.connections.visitor' => $original]);
            app()->forgetInstance(SandboxContext::class);
            Auth::forgetGuards();
        }
    }
}
