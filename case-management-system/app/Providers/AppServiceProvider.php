<?php

namespace App\Providers;

use App\Auth\SimulatedGoogleProvider;
use App\Contracts\MailboxConnector;
use App\Contracts\SignInProvider;
use App\Enums\CasefileMode;
use App\Exceptions\ModeNotConfigured;
use App\Mailbox\SimulatedMailbox;
use App\Support\ModeGuard;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use ValueError;

class AppServiceProvider extends ServiceProvider
{
    /**
     * @return void
     *
     * @throws ValueError
     */
    public function register(): void
    {
        if (in_array(CasefileMode::current(), [CasefileMode::Local, CasefileMode::Demo], true)) {
            $this->app->bind(SignInProvider::class, SimulatedGoogleProvider::class);
            $this->app->bind(MailboxConnector::class, SimulatedMailbox::class);
        }
    }

    /**
     * @return void
     *
     * @throws ValueError
     * @throws ModeNotConfigured
     */
    public function boot(): void
    {
        ModeGuard::assertRunnable(CasefileMode::current());

        RateLimiter::for('sign-in', fn (Request $request): Limit => Limit::perMinute(config('casefile.sign_in.attempts_per_minute'))->by($request->ip()));
        RateLimiter::for('demo-controls', fn (Request $request): Limit => Limit::perMinute(config('casefile.demo.attempts_per_minute'))->by((string) $request->user()->getAuthIdentifier().'|'.$request->ip()));
        RateLimiter::for('case-actions', fn (Request $request): Limit => Limit::perMinute(config('casefile.actions.attempts_per_minute'))->by((string) $request->user()->getAuthIdentifier().'|'.$request->ip()));
        RateLimiter::for('sandbox', fn (string $clientKey): Limit => Limit::perHour(config('casefile.sandbox.provisions_per_hour'))->by('sandbox:'.$clientKey));
    }
}
