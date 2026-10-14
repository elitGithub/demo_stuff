<?php

namespace Webkul\Turnkey\Console\Commands;

use Illuminate\Console\Command;
use LogicException;
use Webkul\Turnkey\Database\Seeders\DemoSeeder;

class PrepareDemo extends Command
{
    protected $signature = 'turnkey:demo';

    protected $description = 'Populate an initialized, empty Turnkey demo database with fictional CRM records';

    public function handle(DemoSeeder $seeder): int
    {
        try {
            $seeder->run();
        } catch (LogicException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->info('Turnkey demo prepared: 8 companies, 12 contacts, 12 opportunities, 16 activities, 4 services and 4 quotes.');
        $this->line('Sign in at '.rtrim(config('app.url'), '/').'/'.trim(config('app.admin_path', 'admin'), '/').'/login');
        $this->line('Shared demo account: '.config('turnkey.demo_email').'. Its demo password is shown on the local login page.');

        return self::SUCCESS;
    }
}
