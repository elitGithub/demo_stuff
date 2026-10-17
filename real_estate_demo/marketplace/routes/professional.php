<?php

use App\Http\Controllers\OpportunityController;
use App\Http\Controllers\ProviderProfileController;
use App\Http\Controllers\QuoteController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth', 'role:provider'])->group(function (): void {
    Route::get('/professional/profile', [ProviderProfileController::class, 'edit'])->name('profile.edit');
    Route::put('/professional/profile', [ProviderProfileController::class, 'update'])->name('profile.update');
    Route::get('/opportunities', OpportunityController::class)->name('opportunities.index');
    Route::post('/requests/{serviceRequest}/quotes', [QuoteController::class, 'store'])->name('quotes.store');
    Route::patch('/quotes/{quote}', [QuoteController::class, 'update'])->name('quotes.update');
});
