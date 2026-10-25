<?php

namespace App\Http\Middleware;

use App\Cache\CapacityAwareDatabaseLock;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Closure;
use ErrorException;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Contracts\Session\Session;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;

class BoundRegistrySession extends StartSession
{
    /**
     * @param  Request  $request
     * @param  Closure  $next
     * @return Response
     */
    public function handle($request, Closure $next): Response
    {
        try {
            app(SandboxService::class)->prepareRegistry();
            app(SandboxService::class)->collectRegistry(CarbonImmutable::now());

            return parent::handle($request, $next);
        } catch (QueryException|RuntimeException|ErrorException $exception) {
            if ($exception instanceof HttpException) {
                throw $exception;
            }
            throw app(SandboxService::class)->storageException($exception);
        } catch (LockTimeoutException $exception) {
            throw new HttpException(503, 'This session is busy. Please try again.', $exception, ['Retry-After' => '2']);
        }
    }

    /**
     * @param  Request  $request
     * @param  mixed  $session
     * @param  Closure  $next
     * @return Response
     */
    protected function handleStatefulRequest(Request $request, $session, Closure $next): Response
    {
        $session->getHandler()->assertNotRevoked($session->getId());
        $incoming = $request->cookies->get($session->getName());
        if (is_string($incoming) && ! DB::connection('registry')->table('sessions')->where('id', $session->getId())->where('last_activity', '>', CarbonImmutable::now()->subMinutes(config('session.lifetime'))->timestamp)->exists() && ! $request->routeIs('demo.start')) {
            throw new HttpException(410, 'This demo session has expired.');
        }

        return parent::handleStatefulRequest($request, $session, $next);
    }

    /**
     * @param  Request  $request
     * @param  mixed  $session
     * @param  Closure  $next
     * @return Response
     */
    protected function handleRequestWhileBlocking(Request $request, $session, Closure $next): Response
    {
        $route = $request->route();
        if (! $route instanceof Route) {
            throw new RuntimeException('A stateful request requires a route.');
        }
        $store = $this->cache($this->manager->blockDriver())->getStore();
        $lock = new CapacityAwareDatabaseLock(
            $store->getLockConnection(),
            config('cache.stores.database.lock_table'),
            $store->getPrefix().'session:'.$session->getId(),
            $route->locksFor() ?: $this->manager->defaultRouteBlockLockSeconds(),
            lottery: config('cache.stores.database.lock_lottery'),
        );
        $lock->betweenBlockedAttemptsSleepFor(50);
        try {
            $lock->block($route->waitsFor() ?? $this->manager->defaultRouteBlockWaitSeconds());

            return $this->handleStatefulRequest($request, $session, $next);
        } finally {
            $lock->release();
        }
    }

    /**
     * @param  Response  $response
     * @param  Session  $session
     * @return void
     */
    protected function addCookieToResponse(Response $response, Session $session): void
    {
        $session->getHandler()->assertNotRevoked($session->getId());
        parent::addCookieToResponse($response, $session);
    }
}
