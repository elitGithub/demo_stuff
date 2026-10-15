<?php

namespace Webkul\Turnkey\Providers;

use Illuminate\Mail\Events\MessageSending;
use Illuminate\Support\ServiceProvider;
use Webkul\Turnkey\Console\Commands\PrepareDemo;
use Webkul\Turnkey\DataGrids\ActivityDataGrid;
use Webkul\Turnkey\DataGrids\LeadDataGrid;
use Webkul\Turnkey\DataGrids\OrganizationDataGrid;
use Webkul\Turnkey\DataGrids\PersonDataGrid;
use Webkul\Turnkey\DataGrids\QuoteDataGrid;
use Webkul\Turnkey\Http\Middleware\ProtectDemo;
use Webkul\Turnkey\Support\DemoAccess;

class TurnkeyServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__.'/../Config/turnkey.php', 'turnkey');
        $this->app->bind(
            \Webkul\Admin\DataGrids\Activity\ActivityDataGrid::class,
            ActivityDataGrid::class,
        );
        foreach ([
            \Webkul\Admin\DataGrids\Contact\PersonDataGrid::class => PersonDataGrid::class,
            \Webkul\Admin\DataGrids\Contact\OrganizationDataGrid::class => OrganizationDataGrid::class,
            \Webkul\Admin\DataGrids\Lead\LeadDataGrid::class => LeadDataGrid::class,
            \Webkul\Admin\DataGrids\Quote\QuoteDataGrid::class => QuoteDataGrid::class,
        ] as $base => $presentation) {
            $this->app->bind($base, $presentation);
        }
    }

    public function boot(): void
    {
        if ($this->app['config']->get('turnkey.shared_hosting')) {
            // The release puts public files directly in htdocs. No symlink is needed.
            $this->app['config']->set('filesystems.links', []);
            $this->app['config']->set('filesystems.disks.public.root', public_path('storage'));

            // Dompdf otherwise assumes a public directory inside the private app.
            $this->app['config']->set('dompdf.public_path', public_path());

            // The hosted demo has no outbound mail or installer telemetry.
            $this->app['config']->set('mail.default', 'log');
            $this->app['events']->listen(MessageSending::class, fn () => false);
            $this->app['events']->forget('krayin.installed');
        }

        $views = __DIR__.'/../Resources/views';
        $this->loadViewsFrom($views, 'turnkey');
        $this->loadTranslationsFrom(__DIR__.'/../Resources/lang', 'turnkey');
        $this->app['view']->prependNamespace('admin', $views.'/admin');

        // Blade resolves admin::components through this same namespace before
        // consulting the original anonymous-component path; missing overrides fall back.
        $this->app['router']->pushMiddlewareToGroup('web', ProtectDemo::class);
        $this->app['router']->pushMiddlewareToGroup('api', ProtectDemo::class);

        if ($this->app['config']->get('turnkey.demo')) {
            $this->app['config']->set('menu.admin', array_values(array_filter(
                $this->app['config']->get('menu.admin', []),
                fn ($item) => DemoAccess::allows($item['route'], false),
            )));
            $this->app['config']->set('mail.default', 'log');
            $this->app['events']->listen(MessageSending::class, fn () => false);
        }

        if ($this->app->runningInConsole()) {
            $this->commands([PrepareDemo::class]);
        }
    }
}
