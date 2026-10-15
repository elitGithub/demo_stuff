<?php

namespace Database\Seeders;

use App\Models\Client;
use App\Models\Subscriber;
use App\Services\OutreachService;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use RuntimeException;

class OutreachSeeder extends Seeder
{
    public function run(): void
    {
        if (! config('studio.demo')) {
            throw new RuntimeException('Outreach demo seeding requires STUDIO_DEMO=true.');
        }
        $today = CarbonImmutable::now(config('studio.timezone'));
        Client::firstOrCreate(['email' => 'occasion.guest@outreach.example.test'], [
            'name' => 'Avery Lane', 'phone' => '+15550101990', 'source' => 'demo-outreach',
            'birthday' => $today->subYearsNoOverflow(30)->toDateString(),
            'anniversary' => $today->subYearsNoOverflow(5)->toDateString(),
            'channels' => [], 'marketing_channels' => ['email'],
        ]);
        foreach (['avery.news@outreach.example.test', 'jules.news@outreach.example.test'] as $email) {
            Subscriber::firstOrCreate(['email' => $email], ['consented_at' => now()]);
        }
        app(OutreachService::class)->generateDue();
    }
}
