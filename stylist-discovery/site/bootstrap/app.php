<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\AvailabilityController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\InboxController;
use App\Http\Controllers\PortfolioController;
use App\Http\Controllers\ServiceController;
use App\Http\Controllers\StylistProfileController;
use App\Http\Middleware\BindSandbox;
use App\Http\Middleware\BoundRegistrySession;
use App\Http\Middleware\EnsureActorContext;
use App\Http\Middleware\EnsureRole;
use App\Services\BookingService;
use App\Services\InboxService;
use App\Services\SandboxService;
use App\Services\StylistService;
use Illuminate\Auth\Middleware\Authorize;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\HandlePrecognitiveRequests;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\MessageBag;
use Illuminate\Support\ViewErrorBag;
use Illuminate\Validation\ValidationException;
use Illuminate\View\Middleware\ShareErrorsFromSession;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        using: function (): void {
            require __DIR__.'/../routes/web.php';
        },
        commands: __DIR__.'/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->web(replace: [StartSession::class => BoundRegistrySession::class]);
        $middleware->alias(['sandbox' => BindSandbox::class, 'actor' => EnsureActorContext::class, 'role' => EnsureRole::class]);
        $middleware->redirectGuestsTo(fn (): string => route('login'));
        $middleware->priority([
            HandlePrecognitiveRequests::class,
            EncryptCookies::class,
            AddQueuedCookiesToResponse::class,
            BoundRegistrySession::class,
            ShareErrorsFromSession::class,
            BindSandbox::class,
            EnsureActorContext::class,
            PreventRequestForgery::class,
            AuthenticatesRequests::class,
            EnsureRole::class,
            SubstituteBindings::class,
            Authorize::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->map(QueryException::class, fn (QueryException $exception) => app(SandboxService::class)->storageException($exception));
        $exceptions->dontFlash(['password', 'password_confirmation', 'current_password', 'image']);
        $exceptions->render(function (ValidationException $exception, Request $request) {
            if ($request->expectsJson()) {
                return response()->json(['message' => $exception->getMessage(), 'errors' => $exception->errors()], 422);
            }
            if ($request->routeIs('admin.publish', 'admin.suspend')) {
                $form = app(AdminController::class)->application($request, (int) $request->route('profile'));

                return response()->view($form->name(), array_merge($form->getData(), ['errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))]), 422);
            }
            if ($request->routeIs('admin.*')) {
                return response()->view('admin.invalid', ['errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))], 422);
            }
            if ($request->routeIs('stylist.portfolio.store', 'stylist.portfolio.destroy')) {
                $form = app(PortfolioController::class)->index($request, app(StylistService::class));
                $caption = $request->input('caption');

                return response()->view($form->name(), array_merge($form->getData(), ['caption' => is_string($caption) ? mb_substr($caption, 0, 160) : '', 'errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))]), 422);
            }
            if ($request->routeIs('bookings.accept', 'bookings.decline', 'bookings.handoff', 'checkout.store', 'bookings.cancel', 'bookings.complete')) {
                $form = app(BookingController::class)->show($request, app(BookingService::class), (int) $request->route('booking'));

                return response()->view($form->name(), array_merge($form->getData(), ['errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))]), 422);
            }
            if ($request->routeIs('workspace.index')) {
                return response()->view('workspaces.invalid', ['errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))], 422);
            }
            if ($request->routeIs('inbox.read')) {
                $form = app(InboxController::class)->index($request, app(InboxService::class), app(BookingService::class));

                return response()->view($form->name(), array_merge($form->getData(), ['errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))]), 422);
            }
            if ($request->routeIs('stylist.availability.update', 'stylist.time-off.store', 'stylist.time-off.destroy')) {
                $form = app(AvailabilityController::class)->edit($request, app(StylistService::class));
                $values = [];
                foreach (['starts_local', 'ends_local'] as $field) {
                    $values[$field] = is_string($request->input($field)) ? mb_substr($request->input($field), 0, 16) : '';
                }
                $values['days'] = [];
                $days = $request->input('days');
                if (is_array($days)) {
                    foreach (array_slice(array_values($days), 0, 7) as $index => $day) {
                        if (is_array($day)) {
                            foreach (['weekday' => 1, 'open' => 1, 'opens_at' => 5, 'closes_at' => 5] as $field => $maximum) {
                                $values['days'][$index][$field] = isset($day[$field]) && is_scalar($day[$field]) ? mb_substr((string) $day[$field], 0, $maximum) : '';
                            }
                        }
                    }
                }

                return response()->view($form->name(), array_merge($form->getData(), ['values' => $values, 'errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))]), 422);
            }
            if ($request->routeIs('bookings.create', 'bookings.review', 'bookings.continue-client', 'bookings.store', 'inbox.index', 'stylist.availability.edit')) {
                return response()->view('bookings.invalid', ['errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))], 422);
            }
            if ($request->routeIs('stylist.profile.update', 'stylist.services.store', 'stylist.services.update', 'stylist.submit')) {
                $values = [];
                foreach (['display_name' => 80, 'studio_name' => 80, 'biography' => 1200, 'address' => 180, 'city_code' => 16, 'deposit_percent' => 3, 'name' => 80, 'specialty_id' => 10, 'price' => 8, 'duration_minutes' => 3, 'active' => 1] as $field => $maximum) {
                    $value = $request->input($field);
                    $values[$field] = is_scalar($value) ? mb_substr((string) $value, 0, $maximum) : '';
                }
                $specialtyIds = $request->input('specialty_ids');
                $values['specialty_ids'] = is_array($specialtyIds) ? array_values(array_filter(array_slice($specialtyIds, 0, 6), fn ($specialtyId): bool => is_scalar($specialtyId))) : [];
                $stylists = app(StylistService::class);
                $form = match ($request->route()->getName()) {
                    'stylist.profile.update' => app(StylistProfileController::class)->edit($request, $stylists),
                    'stylist.submit' => app(StylistProfileController::class)->onboarding($request, $stylists),
                    default => app(ServiceController::class)->edit($request, $stylists, $request->route('service') === null ? null : (int) $request->route('service')),
                };

                return response()->view($form->name(), array_merge($form->getData(), ['values' => $values, 'errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))]), 422);
            }
            $template = match ($request->route()?->getName()) {
                'login.store' => 'auth.login',
                'register.store' => 'auth.register',
                'account.update', 'role.update' => 'account.edit',
                default => null,
            };
            if ($template === null) {
                return null;
            }
            $values = [];
            foreach (['name' => 80, 'email' => 254, 'role' => 16] as $field => $maximum) {
                $value = $request->input($field);
                if ($request->has($field)) {
                    $values[$field] = is_string($value) ? mb_substr($value, 0, $maximum) : '';
                }
            }

            return response()->view($template, ['values' => $values, 'errors' => (new ViewErrorBag)->put('default', new MessageBag($exception->errors()))], 422);
        });
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request): bool => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
