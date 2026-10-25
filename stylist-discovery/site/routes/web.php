<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\AvailabilityController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\BookingDecisionController;
use App\Http\Controllers\BookingLifecycleController;
use App\Http\Controllers\CheckoutController;
use App\Http\Controllers\DemoEntryController;
use App\Http\Controllers\DiscoveryController;
use App\Http\Controllers\InboxController;
use App\Http\Controllers\PortfolioController;
use App\Http\Controllers\RegistrationController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\ServiceController;
use App\Http\Controllers\SessionController;
use App\Http\Controllers\StylistProfileController;
use App\Http\Controllers\WorkspaceController;
use Illuminate\Support\Facades\Route;

Route::middleware('web')->group(function (): void {
    Route::view('/', 'landing')->name('landing');
    Route::get('/demo/start', [DemoEntryController::class, 'start'])->name('demo.start');
    Route::post('/demo/enter', [DemoEntryController::class, 'enter'])->middleware('sandbox')->name('demo.enter');
    Route::get('/demo/ready', [DiscoveryController::class, 'index'])->middleware('sandbox')->name('demo.ready');
    Route::middleware(['sandbox', 'actor'])->group(function (): void {
        Route::get('/discover', [DiscoveryController::class, 'index'])->name('discovery.index');
        Route::get('/stylists/{profile}', [DiscoveryController::class, 'show'])->whereNumber('profile')->name('stylists.show');
        Route::get('/bookings/create', [AvailabilityController::class, 'slots'])->name('bookings.create');
        Route::get('/bookings/review', [BookingController::class, 'review'])->name('bookings.review');
        Route::get('/login', [SessionController::class, 'create'])->name('login');
        Route::post('/login', [SessionController::class, 'store'])->middleware('throttle:login')->name('login.store');
        Route::get('/register', [RegistrationController::class, 'create'])->name('register');
        Route::post('/register', [RegistrationController::class, 'store'])->middleware('throttle:signup')->name('register.store');
        Route::middleware('auth')->group(function (): void {
            Route::post('/bookings/review/client', [BookingController::class, 'continueAsClient'])->middleware('throttle:role-switch')->name('bookings.continue-client');
            Route::middleware('role:admin')->prefix('admin')->name('admin.')->group(function (): void {
                Route::get('/', [AdminController::class, 'index'])->name('index');
                Route::get('/applications', [AdminController::class, 'applications'])->name('applications');
                Route::get('/applications/{profile}', [AdminController::class, 'application'])->whereNumber('profile')->name('application');
                Route::post('/applications/{profile}/publish', [AdminController::class, 'publish'])->whereNumber('profile')->middleware('throttle:mutations')->name('publish');
                Route::post('/applications/{profile}/suspend', [AdminController::class, 'suspend'])->whereNumber('profile')->middleware('throttle:mutations')->name('suspend');
                Route::get('/bookings', [AdminController::class, 'bookings'])->name('bookings');
                Route::get('/specialties', [AdminController::class, 'specialties'])->name('specialties');
                Route::post('/specialties/{specialty}', [AdminController::class, 'setSpecialty'])->whereNumber('specialty')->middleware('throttle:mutations')->name('specialties.update');
            });
            Route::get('/portfolio/{image}', [PortfolioController::class, 'show'])->whereNumber('image')->name('portfolio.show');
            Route::get('/workspace', [WorkspaceController::class, 'index'])->name('workspace.index');
            Route::get('/bookings/{booking}/deposit', [CheckoutController::class, 'show'])->whereNumber('booking')->name('checkout.show');
            Route::post('/bookings/{booking}/deposit', [CheckoutController::class, 'store'])->whereNumber('booking')->middleware('throttle:mutations')->name('checkout.store');
            Route::post('/bookings/{booking}/cancel', [BookingLifecycleController::class, 'cancel'])->whereNumber('booking')->middleware('throttle:mutations')->name('bookings.cancel');
            Route::post('/bookings/{booking}/complete', [BookingLifecycleController::class, 'complete'])->whereNumber('booking')->middleware('throttle:mutations')->name('bookings.complete');
            Route::post('/bookings', [BookingController::class, 'store'])->middleware('throttle:mutations')->name('bookings.store');
            Route::get('/bookings/{booking}', [BookingController::class, 'show'])->whereNumber('booking')->name('bookings.show');
            Route::post('/bookings/{booking}/accept', [BookingDecisionController::class, 'update'])->whereNumber('booking')->middleware('throttle:mutations')->name('bookings.accept');
            Route::post('/bookings/{booking}/decline', [BookingDecisionController::class, 'update'])->whereNumber('booking')->middleware('throttle:mutations')->name('bookings.decline');
            Route::post('/bookings/{booking}/perspective', [BookingController::class, 'handoff'])->whereNumber('booking')->middleware('throttle:role-switch')->name('bookings.handoff');
            Route::get('/inbox', [InboxController::class, 'index'])->name('inbox.index');
            Route::post('/inbox/{message}/read', [InboxController::class, 'read'])->whereNumber('message')->middleware('throttle:mutations')->name('inbox.read');
            Route::middleware('role:stylist')->prefix('stylist')->name('stylist.')->group(function (): void {
                Route::get('/portfolio', [PortfolioController::class, 'index'])->name('portfolio.index');
                Route::post('/portfolio', [PortfolioController::class, 'store'])->middleware('throttle:mutations')->name('portfolio.store');
                Route::delete('/portfolio/{image}', [PortfolioController::class, 'destroy'])->whereNumber('image')->middleware('throttle:mutations')->name('portfolio.destroy');
                Route::get('/setup', [StylistProfileController::class, 'onboarding'])->name('onboarding');
                Route::get('/availability', [AvailabilityController::class, 'edit'])->name('availability.edit');
                Route::patch('/availability', [AvailabilityController::class, 'update'])->middleware('throttle:mutations')->name('availability.update');
                Route::post('/time-off', [AvailabilityController::class, 'storeTimeOff'])->middleware('throttle:mutations')->name('time-off.store');
                Route::delete('/time-off/{timeOff}', [AvailabilityController::class, 'destroyTimeOff'])->whereNumber('timeOff')->middleware('throttle:mutations')->name('time-off.destroy');
                Route::get('/profile', [StylistProfileController::class, 'edit'])->name('profile.edit');
                Route::patch('/profile', [StylistProfileController::class, 'update'])->middleware('throttle:mutations')->name('profile.update');
                Route::post('/submit', [StylistProfileController::class, 'submit'])->middleware('throttle:mutations')->name('submit');
                Route::get('/services', [ServiceController::class, 'index'])->name('services.index');
                Route::get('/services/create', [ServiceController::class, 'edit'])->name('services.create');
                Route::post('/services', [ServiceController::class, 'save'])->middleware('throttle:mutations')->name('services.store');
                Route::get('/services/{service}/edit', [ServiceController::class, 'edit'])->whereNumber('service')->name('services.edit');
                Route::patch('/services/{service}', [ServiceController::class, 'save'])->whereNumber('service')->middleware('throttle:mutations')->name('services.update');
            });
            Route::get('/account', [AccountController::class, 'edit'])->name('account.edit');
            Route::patch('/account', [AccountController::class, 'update'])->middleware('throttle:mutations')->name('account.update');
            Route::post('/demo/role', [RoleController::class, 'update'])->middleware('throttle:role-switch')->name('role.update');
            Route::post('/logout', [SessionController::class, 'destroy'])->middleware('throttle:mutations')->name('logout');
        });
    });
});
