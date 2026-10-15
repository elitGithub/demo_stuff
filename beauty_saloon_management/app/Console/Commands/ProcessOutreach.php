<?php

namespace App\Console\Commands;

use App\Services\OutreachService;
use Illuminate\Console\Command;

class ProcessOutreach extends Command
{
    protected $signature = 'outreach:process';

    protected $description = 'Create due occasion previews and simulate consented outreach without sending messages';

    public function handle(OutreachService $outreach): int
    {
        $created = $outreach->generateDue();
        $simulated = $outreach->processDue();
        $this->info($created.' previews created; '.$simulated.' simulated. No outbound delivery.');

        return self::SUCCESS;
    }
}
