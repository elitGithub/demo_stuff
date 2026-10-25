<?php

namespace App\Console\Commands;

use App\Services\FixtureService;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('demo:build-fixtures {--output=}')]
#[Description('Build new pristine fictional demo fixtures')]
class BuildDemoFixtures extends Command
{
    /**
     * @param  FixtureService  $fixtures
     * @return int
     */
    public function handle(FixtureService $fixtures): int
    {
        $output = $this->option('output');

        if (! is_string($output) || $output === '') {
            $this->error('An explicit new output directory is required.');

            return self::FAILURE;
        }

        $fixtures->build($output);
        $this->info('Pristine registry and template created.');

        return self::SUCCESS;
    }
}
