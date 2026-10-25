<?php

namespace App\Providers;

use App\Http\Middleware\BoundRegistrySession;
use App\Session\RegistrySessionHandler;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiter;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Session\SessionManager;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Session;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * @return void
     */
    public function boot(): void
    {
        Date::use(CarbonImmutable::class);
        Http::preventStrayRequests();
        $this->app->afterResolving(RateLimiter::class, function (RateLimiter $limiter): void {
            $limiter->for('login', function (Request $request): array {
                $email = $request->input('email');
                $identifier = is_string($email) ? mb_strtolower(trim(mb_substr($email, 0, 254))) : '';
                $ip = (string) $request->server('REMOTE_ADDR');

                return [
                    Limit::perMinute(config('demo.rate_limits.login_identifier'))->by('login-identifier:'.hash_hmac('sha256', $ip.'|'.$identifier, config('app.key'))),
                    Limit::perMinute(config('demo.rate_limits.login_ip'))->by('login-ip:'.hash_hmac('sha256', $ip, config('app.key'))),
                ];
            });
            $limiter->for('signup', fn (Request $request): Limit => Limit::perHour(config('demo.rate_limits.signup'))->by(hash_hmac('sha256', (string) $request->server('REMOTE_ADDR'), config('app.key'))));
            $limiter->for('role-switch', fn (Request $request): Limit => Limit::perMinute(config('demo.rate_limits.role_switch'))->by(hash_hmac('sha256', $request->session()->get('sandbox_token'), config('app.key'))));
            $limiter->for('mutations', fn (Request $request): Limit => Limit::perMinute(config('demo.rate_limits.mutations'))->by(hash_hmac('sha256', $request->session()->get('sandbox_token'), config('app.key'))));
        });
        Session::extend('bounded-registry', function ($application): RegistrySessionHandler {
            return new RegistrySessionHandler(DB::connection(config('session.connection')), 'sessions', config('session.lifetime'));
        });
        $this->app->singleton(BoundRegistrySession::class, function ($application): BoundRegistrySession {
            return new BoundRegistrySession($application->make(SessionManager::class), fn () => $application->make('cache'));
        });
    }
}
