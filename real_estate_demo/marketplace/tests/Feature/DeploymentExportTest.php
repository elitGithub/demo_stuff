<?php

namespace Tests\Feature;

use App\Models\RequestPhoto;
use Database\Seeders\DemoSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\Support\InfinityFreeExport;
use Tests\TestCase;

class DeploymentExportTest extends TestCase
{
    use RefreshDatabase;

    public function test_fictional_export_uses_mysql_schema_without_connecting_to_mysql(): void
    {
        Storage::fake('request-photos');
        $this->seed(DemoSeeder::class);
        $sql = InfinityFreeExport::sql();
        $tick = chr(96);
        foreach (['users', 'categories', 'provider_profiles', 'service_requests', 'quotes', 'messages', 'reviews', 'payments', 'notifications', 'migrations'] as $table) {
            self::assertStringContainsString("create table {$tick}{$table}{$tick}", strtolower($sql));
            self::assertStringContainsString("INSERT INTO {$tick}{$table}{$tick}", $sql);
        }
        self::assertDoesNotMatchRegularExpression('/^\s*DROP\s/m', $sql);
        self::assertDoesNotMatchRegularExpression('/^\s*TRUNCATE\s/m', $sql);
        self::assertStringContainsString('engine = InnoDB', $sql);
        self::assertStringContainsString('FOREIGN KEY', strtoupper($sql));
        self::assertStringContainsString("UPDATE {$tick}service_requests{$tick} SET {$tick}accepted_quote_id{$tick}", $sql);

        // Keep this verified fictional fixture as an ignored, reviewable deployment artifact.
        $output = dirname(base_path()).'/.cache/deploy-fixtures/'.bin2hex(random_bytes(8));
        mkdir($output, 0700, true);
        file_put_contents($output.'/import.sql', $sql);
        $photo = RequestPhoto::sole();
        mkdir($output.'/photos/requests', 0700, true);
        file_put_contents($output.'/photos/'.$photo->path, Storage::disk('request-photos')->get($photo->path));
        file_put_contents(dirname(base_path()).'/.cache/latest-deploy-fixture.txt', $output);
        self::assertFileExists($output.'/photos/'.$photo->path);
    }
}
