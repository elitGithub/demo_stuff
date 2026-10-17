<?php

use App\Http\Controllers\Auth\DemoSessionController;
use App\Http\Controllers\Auth\RegistrationController;
use App\Http\Controllers\Auth\SessionController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DiscoveryController;
use App\Http\Controllers\JobStatusController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\PaymentController;
use App\Http\Controllers\RequestPhotoController;
use App\Http\Controllers\ReviewController;
use App\Http\Controllers\ServiceRequestController;
use Illuminate\Support\Facades\Route;

Route::get('/', [DiscoveryController::class, 'home'])->name('home');
Route::get('/services', [DiscoveryController::class, 'categories'])->name('categories.index');
Route::get('/professionals', [DiscoveryController::class, 'professionals'])->name('professionals.index');
Route::get('/professionals/{profile:slug}', [DiscoveryController::class, 'show'])->name('professionals.show');

require __DIR__.'/customer.php';
require __DIR__.'/professional.php';
require __DIR__.'/admin.php';

Route::middleware('guest')->group(function (): void {
    Route::get('/register', [RegistrationController::class, 'create'])->name('register');
    Route::post('/register', [RegistrationController::class, 'store'])->middleware('throttle:10,1')->name('register.store');
    Route::get('/login', [SessionController::class, 'create'])->name('login');
    Route::post('/login', [SessionController::class, 'store'])->middleware('throttle:5,1')->name('login.store');
});

Route::post('/demo/{actor}', DemoSessionController::class)->middleware('throttle:10,1')->name('demo.login');

Route::middleware('auth')->group(function (): void {
    Route::get('/dashboard', DashboardController::class)->name('dashboard');
    Route::post('/logout', [SessionController::class, 'destroy'])->name('logout');

    Route::get('/requests/{serviceRequest}', [ServiceRequestController::class, 'show'])->name('requests.show');
    Route::get('/photos/{requestPhoto}', RequestPhotoController::class)->name('photos.show');
    Route::post('/requests/{serviceRequest}/status', [JobStatusController::class, 'update'])->name('jobs.status');
    Route::post('/requests/{serviceRequest}/cancel', [JobStatusController::class, 'cancel'])->name('jobs.cancel');
    Route::get('/requests/{serviceRequest}/checkout', [PaymentController::class, 'create'])->name('payments.create');
    Route::post('/requests/{serviceRequest}/checkout', [PaymentController::class, 'store'])->name('payments.store');
    Route::get('/payments/{payment}', [PaymentController::class, 'show'])->name('payments.show');
    Route::get('/requests/{serviceRequest}/review', [ReviewController::class, 'create'])->name('reviews.create');
    Route::post('/requests/{serviceRequest}/review', [ReviewController::class, 'store'])->name('reviews.store');
    Route::get('/notifications', [NotificationController::class, 'index'])->name('notifications.index');
    Route::post('/notifications/{notification}/read', [NotificationController::class, 'read'])->name('notifications.read');
    Route::middleware('role:customer,provider')->group(function (): void {
        Route::get('/messages', [ConversationController::class, 'index'])->name('messages.index');
        Route::get('/conversations/{quote}', [ConversationController::class, 'show'])->name('conversations.show');
        Route::post('/conversations/{quote}/messages', MessageController::class)->name('messages.store');
    });
});
