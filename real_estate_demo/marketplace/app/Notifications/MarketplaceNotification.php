<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;

class MarketplaceNotification extends Notification
{
    public function __construct(
        public string $title,
        public string $body,
        public string $routeName,
        public array $routeParameters = [],
    ) {}

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toDatabase(object $notifiable): array
    {
        return [
            'title' => $this->title, 'body' => $this->body,
            'route_name' => $this->routeName, 'route_parameters' => $this->routeParameters,
        ];
    }
}
