<?php

use App\Http\Controllers\QuoteController;
use App\Http\Controllers\ServiceRequestController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth', 'role:customer'])->group(function (): void {
    Route::get('/requests/create', [ServiceRequestController::class, 'create'])->name('requests.create');
    Route::post('/requests', [ServiceRequestController::class, 'store'])->name('requests.store');
    Route::get('/requests/{serviceRequest}/edit', [ServiceRequestController::class, 'edit'])->name('requests.edit');
    Route::patch('/requests/{serviceRequest}', [ServiceRequestController::class, 'update'])->name('requests.update');
    Route::post('/quotes/{quote}/accept', [QuoteController::class, 'accept'])->name('quotes.accept');
});
