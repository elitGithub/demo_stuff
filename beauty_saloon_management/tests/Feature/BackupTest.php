<?php

namespace Tests\Feature;

use App\Models\Client;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Storage;
use PHPUnit\Framework\Attributes\TestWith;
use Tests\TestCase;

class BackupTest extends TestCase
{
    use DatabaseMigrations;

    public function test_private_backup_contains_consistent_database_and_uploaded_files(): void
    {
        Storage::fake('local');
        Client::create(['name' => 'Backup Example']);
        Storage::disk('local')->put('styles/example.jpg', 'fixture-image');
        Storage::disk('local')->put('demo-credentials.json', 'must not copy');
        $this->artisan('studio:backup')->assertSuccessful();
        $manifest = collect(Storage::disk('local')->allFiles('backups'))->first(fn ($path) => str_ends_with($path, 'manifest.json'));
        $this->assertNotNull($manifest);
        $folder = dirname($manifest);
        $pdo = new \PDO('sqlite:'.Storage::disk('local')->path($folder.'/database.sqlite'));
        $this->assertSame('Backup Example', $pdo->query('SELECT name FROM clients')->fetchColumn());
        Storage::disk('local')->assertExists($folder.'/files/styles/example.jpg');
        Storage::disk('local')->assertMissing($folder.'/files/demo-credentials.json');
    }

    #[TestWith(['copy'])]
    #[TestWith(['put'])]
    #[TestWith(['makeDirectory'])]
    public function test_backup_fails_and_cleans_up_when_storage_reports_failure(string $operation): void
    {
        $disk = Storage::fake('local');
        $disk->put('styles/example.jpg', 'fixture-image');
        $failingDisk = \Mockery::mock($disk);
        $failingDisk->shouldReceive($operation)->once()->andReturn(false);
        Storage::shouldReceive('disk')->with('local')->andReturn($failingDisk);
        $this->artisan('studio:backup')->assertFailed();
        $this->assertSame([], $disk->allFiles('backups'));
    }
}
