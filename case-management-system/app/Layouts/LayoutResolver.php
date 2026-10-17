<?php

namespace App\Layouts;

use App\Enums\WorkspaceLayout;
use Illuminate\Http\Request;

final class LayoutResolver
{
    /**
     * @param  Request  $request
     * @return ?WorkspaceLayout
     */
    public function fromRequest(Request $request): ?WorkspaceLayout
    {
        $cookie = config('casefile.layout.cookie');

        if (! $request->cookies->has($cookie)) {
            return null;
        }

        $value = $request->cookie($cookie);

        return is_string($value)
            ? WorkspaceLayout::tryFromCookie($value) ?? WorkspaceLayout::default()
            : WorkspaceLayout::default();
    }

    /**
     * @return string
     */
    public function cookiePath(): string
    {
        return '/'.trim(parse_url(config('app.url'), PHP_URL_PATH) ?? '', '/');
    }

    /**
     * @param  mixed  $intended
     * @return string
     */
    public function redirectTarget(mixed $intended): string
    {
        $fallback = route('home');

        if (! is_string($intended) || $intended === '' || preg_match('/[\x00-\x20\x7f\\\\]/', $intended)) {
            return $fallback;
        }

        $application = parse_url(config('app.url'));
        $target = parse_url($intended);

        if ($target === false || isset($target['user']) || isset($target['pass'])) {
            return $fallback;
        }

        if (isset($target['host']) || isset($target['scheme'])) {
            if (strtolower($target['scheme'] ?? '') !== strtolower($application['scheme'])
                || strtolower($target['host'] ?? '') !== strtolower($application['host'])
                || ($target['port'] ?? ($target['scheme'] === 'https' ? 443 : 80)) !== ($application['port'] ?? ($application['scheme'] === 'https' ? 443 : 80))) {
                return $fallback;
            }
        } elseif (! str_starts_with($intended, '/') || str_starts_with($intended, '//')) {
            return $fallback;
        }

        $path = $target['path'] ?? '/';
        $prefix = $this->cookiePath();

        for ($pass = 0; $pass < 4; $pass++) {
            if (preg_match('/[\x00-\x20\x7f\\\\]/', $path)
                || str_starts_with($path, '//')
                || preg_match('~(?:^|/)\.{1,2}(?:/|$)~', $path)
                || ($prefix !== '/' && $path !== $prefix && ! str_starts_with($path, $prefix.'/'))) {
                return $fallback;
            }

            $decoded = rawurldecode($path);

            if ($decoded === $path) {
                $origin = $application['scheme'].'://'.$application['host'].(isset($application['port']) ? ':'.$application['port'] : '');

                return isset($target['host']) ? $intended : $origin.$intended;
            }

            $path = $decoded;
        }

        return $fallback;
    }

    /**
     * @param  WorkspaceLayout  $layout
     * @param  string  $page
     * @return string
     */
    public function viewName(WorkspaceLayout $layout, string $page): string
    {
        return 'workspace.'.$layout->value.'.'.$page;
    }
}
