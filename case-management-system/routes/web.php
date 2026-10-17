<?php

use App\Http\Controllers\AttachmentController;
use App\Http\Controllers\CaseController;
use App\Http\Controllers\DemoScriptController;
use App\Http\Controllers\InboxController;
use App\Http\Controllers\LayoutController;
use App\Http\Controllers\MailboxAttachmentController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ReplyController;
use App\Http\Controllers\SandboxResetController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\SettingsController;
use App\Http\Controllers\SignInController;
use App\Http\Controllers\TrackedSenderController;
use App\Http\Controllers\WorkspaceController;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function (): void {
    Route::get('/sign-in', [SignInController::class, 'show'])->name('sign-in');
    Route::post('/sign-in/google', [SignInController::class, 'google'])
        ->middleware('throttle:sign-in')
        ->name('sign-in.google');
});

Route::middleware('auth')->group(function (): void {
    Route::middleware(['demo', 'throttle:demo-controls'])->group(function (): void {
        Route::post('/demo/deliver-next', [DemoScriptController::class, 'deliverNext'])->name('demo.deliver-next');
        Route::post('/demo/deliver-reply', [DemoScriptController::class, 'deliverReply'])->name('demo.deliver-reply');
        Route::post('/demo/cases/{case:number}/auto-reply', [DemoScriptController::class, 'autoReply'])->name('demo.auto-reply');
    });

    Route::get('/', [WorkspaceController::class, 'index'])->middleware('layout.chosen')->name('home');
    Route::get('/layout', [LayoutController::class, 'picker'])->name('layout.picker');
    Route::post('/layout', [LayoutController::class, 'choose'])->middleware('throttle:case-actions')->name('layout.choose');
    Route::get('/search', SearchController::class)->name('search');
    Route::get('/settings', SettingsController::class)->name('settings');
    Route::view('/how-it-runs', 'for-real')->name('for-real');
    Route::get('/inbox', [InboxController::class, 'index'])->name('inbox');
    Route::get('/inbox/{message}', [InboxController::class, 'show'])->whereNumber('message')->name('inbox.show');
    Route::get('/mailbox-attachments/{attachment}', [MailboxAttachmentController::class, 'show'])->whereNumber('attachment')->name('mailbox-attachments.show');
    Route::post('/sign-out', [SignInController::class, 'signOut'])->name('sign-out');
    Route::post('/demo/reset', SandboxResetController::class)->name('demo.reset');
    Route::get('/cases/{case:number}', [CaseController::class, 'show'])->middleware('layout.chosen')->name('cases.show');
    Route::middleware('throttle:case-actions')->group(function (): void {
        Route::post('/settings/senders', [TrackedSenderController::class, 'store'])->name('senders.store');
        Route::patch('/settings/senders/{sender}', [TrackedSenderController::class, 'update'])->whereNumber('sender')->name('senders.update');
        Route::post('/settings/senders/{sender}/deactivate', [TrackedSenderController::class, 'deactivate'])->whereNumber('sender')->name('senders.deactivate');
        Route::post('/settings/senders/{sender}/reactivate', [TrackedSenderController::class, 'reactivate'])->whereNumber('sender')->name('senders.reactivate');
        Route::delete('/settings/senders/{sender}', [TrackedSenderController::class, 'destroy'])->whereNumber('sender')->name('senders.destroy');
        Route::patch('/cases/{case:number}', [CaseController::class, 'update'])->name('cases.update');
        Route::patch('/cases/{case:number}/status', [CaseController::class, 'status'])->name('cases.status');
        Route::post('/cases/{case:number}/replies', [ReplyController::class, 'store'])->name('cases.replies.store');
        Route::post('/notifications/read', [NotificationController::class, 'read'])->name('notifications.read');
    });
    Route::get('/notifications', [NotificationController::class, 'index'])->name('notifications');
    Route::get('/attachments/{attachment}', [AttachmentController::class, 'show'])
        ->whereNumber('attachment')
        ->name('attachments.show');
});
