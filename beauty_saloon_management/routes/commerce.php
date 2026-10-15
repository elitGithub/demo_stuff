<?php

use App\Http\Controllers\CommerceController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:manage-studio')->group(function () {
    Route::get('/retail', [CommerceController::class, 'retail'])->name('retail.index');
    Route::post('/retail/products', [CommerceController::class, 'saveProduct'])->name('retail.products.store');
    Route::put('/retail/products/{product}', [CommerceController::class, 'saveProduct'])->name('retail.products.update');
    Route::post('/retail/{product}/stock', [CommerceController::class, 'adjustStock'])->name('retail.stock');
    Route::post('/retail/checkout', [CommerceController::class, 'checkout'])->name('retail.checkout');
    Route::get('/memberships', [CommerceController::class, 'memberships'])->name('memberships.index');
    Route::post('/memberships/plans', [CommerceController::class, 'savePlan'])->name('memberships.plans.store');
    Route::put('/memberships/plans/{plan}', [CommerceController::class, 'savePlan'])->name('memberships.plans.update');
    Route::post('/memberships', [CommerceController::class, 'enrol'])->name('memberships.store');
    Route::post('/memberships/{membership}/renew', [CommerceController::class, 'renew'])->name('memberships.renew');
});
