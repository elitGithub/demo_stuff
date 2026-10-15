<?php

use App\Http\Controllers\ContentController;
use App\Http\Controllers\OutreachController;
use Illuminate\Support\Facades\Route;

Route::middleware('can:manage-studio')->group(function () {
    Route::get('/outreach', [OutreachController::class, 'index'])->name('outreach.index');
    Route::post('/outreach/generate', [OutreachController::class, 'generate'])->name('outreach.generate');
    Route::post('/outreach/process', [OutreachController::class, 'process'])->name('outreach.process');
    Route::post('/outreach/newsletter', [OutreachController::class, 'newsletter'])->name('outreach.newsletter');
    Route::post('/outreach/subscribers/{subscriber}/suppress', [OutreachController::class, 'suppress'])->name('outreach.suppress');
    Route::get('/content', [ContentController::class, 'edit'])->name('content.edit');
    Route::put('/content', [ContentController::class, 'update'])->name('content.update');
});
