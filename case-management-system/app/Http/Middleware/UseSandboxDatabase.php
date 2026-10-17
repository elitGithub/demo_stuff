<?php

namespace App\Http\Middleware;

use App\Enums\CasefileMode;
use App\Exceptions\SandboxLimitReached;
use App\Sandbox\SandboxStore;
use Closure;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

final class UseSandboxDatabase
{
    /**
     * @param  SandboxStore  $sandboxes
     */
    public function __construct(private readonly SandboxStore $sandboxes) {}

    /**
     * @param  Request  $request
     * @param  Closure(Request): (Response)  $next
     * @return Response
     *
     * @throws SandboxLimitReached
     * @throws LockTimeoutException
     * @throws RuntimeException
     * @throws Throwable
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (! CasefileMode::current()->usesSandboxes()) {
            return $next($request);
        }

        $session = $request->session();
        $id = $session->get(config('casefile.sandbox.session_key'));
        $handle = is_string($id) ? $this->sandboxes->resolve($id) : null;

        if ($handle !== null) {
            $this->sandboxes->attach($handle);

            return $next($request);
        }

        if (! $session->has(Auth::guard()->getName())) {
            return $next($request);
        }

        try {
            $this->sandboxes->start($session, $request->ip());
        } catch (SandboxLimitReached $exception) {
            $session->invalidate();

            throw $exception;
        }

        $session->now('status', SandboxStore::RESET_NOTICE);
        $response = $next($request);

        if ($response->isRedirection()) {
            $session->keep(['status']);
        }

        return $response;
    }
}
