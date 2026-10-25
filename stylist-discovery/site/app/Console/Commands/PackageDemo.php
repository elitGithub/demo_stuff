<?php

namespace App\Console\Commands;

use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use App\Services\DeploymentService;

#[Signature('demo:package {--output=} {--fixtures=}')]
#[Description('Create a new private InfinityFree delivery package')]
class PackageDemo extends Command
{
    /**
     * @param DeploymentService $deployment
     * @return int
     */
    public function handle(DeploymentService $deployment): int
    {
        $output = $this->option('output');
        $fixtures = $this->option('fixtures');
        if (! is_string($output) || $output === '' || ! is_string($fixtures) || $fixtures === '') {
            $this->error('Explicit new output and pristine fixture directories are required.');

            return self::FAILURE;
        }
        $this->info($deployment->package($output, $fixtures));

        return self::SUCCESS;
    }
}
