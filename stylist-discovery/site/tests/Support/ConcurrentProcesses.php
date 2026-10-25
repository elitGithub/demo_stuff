<?php

namespace Tests\Support;

use Illuminate\Support\Collection;
use Symfony\Component\Process\Process;

class ConcurrentProcesses
{
    /**
     * @param  string  $worker
     * @param  Collection<int, string>  $arguments
     * @return Collection<int, Process>
     */
    public static function run(string $worker, Collection $arguments): Collection
    {
        return $arguments->map(function (string $argument) use ($worker): Process {
            $process = new Process([PHP_BINARY, $worker, $argument], dirname(__DIR__, 2), timeout: 15);
            $process->start();

            return $process;
        });
    }
}
