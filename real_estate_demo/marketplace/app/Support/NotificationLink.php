<?php

namespace App\Support;

use Illuminate\Support\Facades\Route;

class NotificationLink
{
    public static function for(array $data): string
    {
        $allowed = [
            'dashboard' => [], 'requests.show' => ['serviceRequest'],
            'conversations.show' => ['quote'], 'profile.edit' => [],
            'payments.show' => ['payment'], 'admin.providers.index' => [],
        ];
        $name = $data['route_name'] ?? '';
        $parameters = $data['route_parameters'] ?? [];

        if (! is_string($name) || ! array_key_exists($name, $allowed) || ! Route::has($name) || ! is_array($parameters)) {
            return route('dashboard');
        }

        $safe = [];
        foreach ($allowed[$name] as $key) {
            $value = $parameters[$key] ?? null;
            if ((! is_string($value) && ! is_int($value)) || ! preg_match('/^[a-zA-Z0-9-]{1,64}$/D', (string) $value)) {
                return route('dashboard');
            }
            $safe[$key] = $value;
        }

        return route($name, $safe);
    }
}
