<?php

namespace Tests\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;

trait BuildsTemplateFile
{
    /**
     * @return string
     */
    protected function buildTemplate(): string
    {
        $suffix = uniqid();
        $template = storage_path('framework/testing/template-'.$suffix.'.sqlite');
        $directory = storage_path('framework/testing/sandboxes-'.$suffix);

        $this->beforeApplicationDestroyed(function () use ($template, $directory): void {
            DB::purge('sqlite');
            File::delete($template);
            File::deleteDirectory($directory);
        });

        File::copy(TemplateCache::path(), $template);

        config([
            'casefile.sandbox.template' => $template,
            'casefile.sandbox.directory' => $directory,
        ]);

        return $template;
    }
}
