<?php

namespace App\Http\Middleware;

use App\Models\StudioSetting;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\HttpFoundation\Response;

class LoadStudioSettings
{
    public function handle(Request $request, Closure $next): Response
    {
        $original = config('studio');
        foreach (StudioSetting::DEFAULTS as $key => $default) {
            config(['studio.'.$key => config('studio.'.$key, $default)]);
        }
        if (Schema::hasTable('studio_settings')) {
            foreach (StudioSetting::whereIn('key', array_keys(StudioSetting::DEFAULTS))->get() as $setting) {
                config(['studio.'.$setting->key => $setting->value]);
            }
        }
        try {
            return $next($request);
        } finally {
            config(['studio' => $original]);
        }
    }
}
