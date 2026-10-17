<?php

namespace App\Providers;

use App\Policies\ConversationPolicy;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void {}

    public function boot(): void
    {
        Gate::define('viewConversation', [ConversationPolicy::class, 'view']);
        Gate::define('sendMessage', [ConversationPolicy::class, 'send']);
    }
}
