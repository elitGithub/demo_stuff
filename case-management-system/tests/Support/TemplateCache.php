<?php

namespace Tests\Support;

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use RuntimeException;

final class TemplateCache
{
    /**
     * @var array<string, string>
     */
    private static array $builds = [];

    /**
     * @return string
     *
     * @throws RuntimeException
     */
    public static function path(): string
    {
        $newest = max(array_map(fn (string $file): string => basename($file, '.php'), File::glob(database_path('migrations/*.php'))));

        if (! isset(self::$builds[$newest])) {
            $path = storage_path('framework/testing/template-'.$newest.'-'.uniqid().'.sqlite');

            register_shutdown_function(function () use ($path): void {
                if (is_file($path)) {
                    unlink($path);
                }
            });

            if (Artisan::call('casefile:build-template', ['--path' => $path, '--force' => true]) !== 0) {
                throw new RuntimeException('The shared test template did not build: '.Artisan::output());
            }

            self::$builds[$newest] = $path;
        }

        return self::$builds[$newest];
    }
}
