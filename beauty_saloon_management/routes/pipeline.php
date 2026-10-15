<?php

use App\Http\Controllers\PipelineController;
use Illuminate\Support\Facades\Route;

Route::get('/pipeline', [PipelineController::class, 'index'])->name('pipeline.index');
Route::get('/pipeline/export', [PipelineController::class, 'export'])->name('pipeline.export');
Route::get('/pipeline/create', [PipelineController::class, 'create'])->name('pipeline.create');
Route::post('/pipeline', [PipelineController::class, 'store'])->name('pipeline.store');
Route::get('/pipeline/{opportunity}', [PipelineController::class, 'show'])->name('pipeline.show');
Route::put('/pipeline/{opportunity}', [PipelineController::class, 'update'])->name('pipeline.update');
Route::post('/pipeline/{opportunity}/transition', [PipelineController::class, 'transition'])->name('pipeline.transition');
Route::post('/pipeline/{opportunity}/reopen', [PipelineController::class, 'reopen'])->middleware('can:manage-studio')->name('pipeline.reopen');
Route::post('/pipeline/{opportunity}/documents', [PipelineController::class, 'upload'])->name('pipeline.documents.store');
Route::get('/pipeline/{opportunity}/documents/{document}', [PipelineController::class, 'download'])->name('pipeline.documents.download');
