<?php

namespace Tests\Feature;

use App\Data\PortfolioInput;
use App\Enums\UploadStatus;
use App\Models\PortfolioImage;
use App\Models\Registry\SandboxFile;
use App\Services\PortfolioService;
use App\Services\SandboxService;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\Support\BuildsPortfolioRuntime;
use Tests\Support\ConcurrentProcesses;
use Tests\Support\PortfolioImages;
use Tests\TestCase;

class PortfolioLifecycleTest extends TestCase
{
    use BuildsPortfolioRuntime;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();
        $this->buildPortfolioRuntime();
    }

    /**
     * @return PortfolioImage
     */
    protected function saveImage(): PortfolioImage
    {
        return app(PortfolioService::class)->store($this->portfolioActor, $this->portfolioContext, new PortfolioInput(image: $this->portfolioUpload(PortfolioImages::bytes()), caption: 'Original abstract QA sample'));
    }

    /**
     * @return void
     */
    public function test_attachment_waits_for_outer_commit_and_removal_waits_for_cleanup(): void
    {
        $connection = DB::connection('visitor');
        $connection->beginTransaction();
        $image = $connection->transaction(fn () => $this->saveImage());
        $this->assertSame(UploadStatus::Reserved, SandboxFile::query()->sole()->status);
        $this->assertFileExists(app(SandboxService::class)->path($image->storage_key));
        $connection->commit();
        $this->assertSame(UploadStatus::Attached, SandboxFile::query()->sole()->status);
        $connection->beginTransaction();
        app(PortfolioService::class)->remove($this->portfolioActor, $this->portfolioContext, $image);
        $this->assertSame(0, PortfolioImage::query()->count());
        $this->assertSame(UploadStatus::Retiring, SandboxFile::query()->sole()->status);
        $this->assertFileExists(app(SandboxService::class)->path($image->storage_key));
        $connection->commit();
        $this->assertFileExists(app(SandboxService::class)->path($image->storage_key));
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now());
        $this->assertSame(0, SandboxFile::query()->count());
        $this->assertFileDoesNotExist(app(SandboxService::class)->path($image->storage_key));
    }

    /**
     * @return void
     */
    public function test_rolled_back_removal_restores_attached_and_never_deletes_reference(): void
    {
        $image = DB::connection('visitor')->transaction(fn () => $this->saveImage());
        DB::connection('visitor')->beginTransaction();
        app(PortfolioService::class)->remove($this->portfolioActor, $this->portfolioContext, $image);
        DB::connection('visitor')->rollBack();
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now());
        $this->assertSame(UploadStatus::Attached, SandboxFile::query()->sole()->status);
        $this->assertFileExists(app(SandboxService::class)->path($image->storage_key));
        app(SandboxService::class)->fixtures->configureConnection('visitor', app(SandboxService::class)->path($this->portfolioContext->digest.'.sqlite'), 1024);
        $this->assertSame(1, PortfolioImage::query()->count());
    }

    /**
     * @return void
     */
    public function test_reservation_failure_creates_no_file_or_visitor_record(): void
    {
        $event = 'eloquent.creating: '.SandboxFile::class;
        Event::listen($event, fn () => throw new RuntimeException('Injected reservation failure.'));
        try {
            DB::connection('visitor')->transaction(fn () => $this->saveImage());
            $this->fail('Injected reservation failure ignored.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('reservation', $exception->getMessage());
        } finally {
            Event::forget($event);
        }
        $this->assertSame(0, SandboxFile::query()->count());
        $this->assertSame(0, PortfolioImage::query()->count());
        $this->assertSame([], glob($this->fixtureDirectory.'/*.png'));
    }

    /**
     * @return void
     */
    public function test_crash_after_reservation_retains_quota_until_four_hour_reclamation(): void
    {
        $event = 'eloquent.created: '.SandboxFile::class;
        Event::listen($event, fn () => throw new RuntimeException('Injected pre-write crash.'));
        try {
            DB::connection('visitor')->transaction(fn () => $this->saveImage());
            $this->fail('Injected crash ignored.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('pre-write', $exception->getMessage());
        } finally {
            Event::forget($event);
        }
        $this->assertSame(UploadStatus::Reserved, SandboxFile::query()->sole()->status);
        $this->assertSame(0, PortfolioImage::query()->count());
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now()->addHours(3));
        $this->assertSame(1, SandboxFile::query()->count());
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now()->addHours(4)->addSecond());
        $this->assertSame(0, SandboxFile::query()->count());
    }

    /**
     * @return void
     */
    public function test_visitor_write_failure_leaves_only_tracked_file_and_later_reclaims_it(): void
    {
        $event = 'eloquent.creating: '.PortfolioImage::class;
        Event::listen($event, fn () => throw new RuntimeException('Injected visitor-write crash.'));
        try {
            DB::connection('visitor')->transaction(fn () => $this->saveImage());
            $this->fail('Injected crash ignored.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('visitor-write', $exception->getMessage());
        } finally {
            Event::forget($event);
        }
        $file = SandboxFile::query()->sole();
        $this->assertSame(UploadStatus::Reserved, $file->status);
        $this->assertSame(0, PortfolioImage::query()->count());
        $this->assertCount(1, glob($this->fixtureDirectory.'/*.png'));
        $this->assertFileExists(app(SandboxService::class)->path($file->storage_key));
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now()->addHours(4)->addSecond());
        $this->assertSame(0, SandboxFile::query()->count());
        $this->assertFileDoesNotExist(app(SandboxService::class)->path($file->storage_key));
    }

    /**
     * @return void
     */
    public function test_file_write_failure_keeps_its_reservation_and_no_visible_image(): void
    {
        $event = 'eloquent.created: '.SandboxFile::class;
        Event::listen($event, function (SandboxFile $file): void {
            mkdir(app(SandboxService::class)->path($file->storage_key), 0700);
        });
        try {
            DB::connection('visitor')->transaction(fn () => $this->saveImage());
            $this->fail('Injected file-write failure ignored.');
        } catch (\ErrorException|RuntimeException $exception) {
            $this->assertNotSame('', $exception->getMessage());
        } finally {
            Event::forget($event);
        }
        $file = SandboxFile::query()->sole();
        $this->assertSame(UploadStatus::Reserved, $file->status);
        $this->assertSame(0, PortfolioImage::query()->count());
        rmdir(app(SandboxService::class)->path($file->storage_key));
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now()->addHours(4)->addSecond());
        $this->assertSame(0, SandboxFile::query()->count());
    }

    /**
     * @return void
     */
    public function test_outer_commit_failure_reclaims_file_without_visitor_reference(): void
    {
        $connection = DB::connection('visitor');
        $connection->beginTransaction();
        $image = $this->saveImage();
        $connection->statement('PRAGMA defer_foreign_keys = ON');
        $connection->table('portfolio_images')->where('id', $image->id)->update(['profile_id' => 999999]);
        try {
            $connection->commit();
            $this->fail('Invalid visitor commit succeeded.');
        } catch (QueryException|\PDOException $exception) {
            $this->assertStringContainsString('FOREIGN KEY', $exception->getMessage());
            $connection->rollBack();
        }
        $this->assertSame(UploadStatus::Reserved, SandboxFile::query()->sole()->status);
        $this->assertSame(0, PortfolioImage::query()->count());
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now()->addHours(4)->addSecond());
        $this->assertSame(0, SandboxFile::query()->count());
        $this->assertFileDoesNotExist(app(SandboxService::class)->path($image->storage_key));
    }

    /**
     * @return void
     */
    public function test_finalization_failure_does_not_remove_committed_reference(): void
    {
        DB::connection('registry')->unprepared("CREATE TRIGGER fail_finalize BEFORE UPDATE OF status ON sandbox_files WHEN NEW.status = 'attached' BEGIN SELECT RAISE(ABORT, 'injected finalize failure'); END");
        $image = DB::connection('visitor')->transaction(fn () => $this->saveImage());
        $this->assertSame(UploadStatus::Reserved, SandboxFile::query()->sole()->status);
        $this->assertSame(1, PortfolioImage::query()->count());
        DB::connection('registry')->unprepared('DROP TRIGGER fail_finalize');
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now()->addHours(4)->addSecond());
        $this->assertSame(UploadStatus::Attached, SandboxFile::query()->sole()->status);
        $this->assertFileExists(app(SandboxService::class)->path($image->storage_key));
    }

    /**
     * @return void
     */
    public function test_delete_failure_retains_slot_and_is_retried(): void
    {
        $image = DB::connection('visitor')->transaction(fn () => $this->saveImage());
        DB::connection('visitor')->transaction(fn () => app(PortfolioService::class)->remove($this->portfolioActor, $this->portfolioContext, $image));
        $path = app(SandboxService::class)->path($image->storage_key);
        unlink($path);
        mkdir($path, 0700);
        try {
            app(SandboxService::class)->reclaimUploads(CarbonImmutable::now());
            $this->fail('Deletion failure ignored.');
        } catch (HttpException $exception) {
            $this->assertSame(503, $exception->getStatusCode());
        }
        $this->assertSame(UploadStatus::Retiring, SandboxFile::query()->sole()->status);
        rmdir($path);
        app(SandboxService::class)->reclaimUploads(CarbonImmutable::now());
        $this->assertSame(0, SandboxFile::query()->count());
    }

    /**
     * @return void
     */
    public function test_ninth_upload_is_429_and_all_ledger_states_count(): void
    {
        $form = $this->enterAccountDemo();
        $this->post('/demo/role', ['_actor_context' => $this->formContext($form), 'role' => 'stylist'])->assertRedirect();
        $this->withCookie('strand_city_session', session()->getId());
        $form = $this->get('/stylist/portfolio')->assertOk();
        for ($index = 0; $index < 8; $index++) {
            $this->post('/stylist/portfolio', ['_actor_context' => $this->formContext($form), 'caption' => 'Sample '.$index, 'image' => $this->portfolioUpload(PortfolioImages::bytes())])->assertRedirect();
        }
        $this->post('/stylist/portfolio', ['_actor_context' => $this->formContext($form), 'caption' => 'Ninth sample', 'image' => $this->portfolioUpload(PortfolioImages::bytes())])->assertStatus(429);
        $this->admitAccountFixture();
        $digest = hash('sha256', session()->get('sandbox_token'));
        $this->assertSame(8, SandboxFile::query()->where('sandbox_digest', $digest)->count());
        $this->assertSame(8, PortfolioImage::query()->count());
        $first = PortfolioImage::query()->first();
        $this->delete('/stylist/portfolio/'.$first->id, ['_actor_context' => $this->formContext($form), 'storage_key' => '../evil'])->assertStatus(422);
        $this->delete('/stylist/portfolio/'.$first->id, ['_actor_context' => $this->formContext($form)])->assertRedirect();
        $this->assertSame(8, SandboxFile::query()->where('sandbox_digest', $digest)->count());
        $this->get('/stylist/portfolio')->assertOk()->assertSee('1 image space remaining');
    }

    /**
     * @return void
     */
    public function test_reserved_and_retiring_slots_also_prevent_a_ninth_reservation(): void
    {
        foreach (range(0, 7) as $index) {
            SandboxFile::query()->create(['sandbox_digest' => $this->portfolioContext->digest, 'storage_key' => hash('sha256', 'quota-'.$index).'.png', 'status' => $index % 2 === 0 ? UploadStatus::Reserved : UploadStatus::Retiring, 'created_at' => CarbonImmutable::now()]);
        }
        try {
            DB::connection('visitor')->transaction(fn () => $this->saveImage());
            $this->fail('Reserved or retiring quota was ignored.');
        } catch (QueryException $exception) {
            $this->assertStringContainsString('capacity:sandbox_uploads', $exception->getMessage());
        }
        $this->assertSame(8, SandboxFile::query()->where('sandbox_digest', $this->portfolioContext->digest)->count());
        $this->assertSame(0, PortfolioImage::query()->count());
        $this->assertSame([], glob($this->fixtureDirectory.'/*.png'));
    }

    /**
     * @return void
     */
    public function test_immutable_seed_image_cannot_be_removed_or_read_as_private_upload(): void
    {
        $image = $this->portfolioActor->profile->portfolioImages()->create(['seed_asset' => 'work-01.svg', 'caption' => 'Original seed illustration', 'position' => 0]);
        foreach (['read', 'remove'] as $operation) {
            try {
                DB::connection('visitor')->transaction(fn () => app(PortfolioService::class)->{$operation}($this->portfolioActor, $this->portfolioContext, $image));
                $this->fail('Immutable seed image accepted by private mutation/read.');
            } catch (HttpException $exception) {
                $this->assertSame(404, $exception->getStatusCode());
            }
        }
        $this->assertSame(1, PortfolioImage::query()->count());
        $this->assertSame(0, SandboxFile::query()->count());
        $this->assertFileExists(public_path('assets/seed/work-01.svg'));
    }

    /**
     * @return void
     */
    public function test_read_bytes_survive_concurrent_cleanup(): void
    {
        $image = DB::connection('visitor')->transaction(fn () => $this->saveImage());
        $service = app(SandboxService::class);
        $path = $service->path($image->storage_key);
        $connection = DB::connection('visitor');
        $connection->beginTransaction();
        $response = app(PortfolioService::class)->read($this->portfolioActor, $this->portfolioContext, $image);
        app(PortfolioService::class)->remove($this->portfolioActor, $this->portfolioContext, $image);
        $arguments = json_encode(['root' => $this->fixtureDirectory, 'operation' => 'uploads', 'session' => [], 'signal' => 'cleanup', 'now' => CarbonImmutable::now()->toIso8601String()], JSON_THROW_ON_ERROR);
        $process = ConcurrentProcesses::run(base_path('tests/Support/sandbox-worker.php'), collect([$arguments]))->sole();
        try {
            $this->awaitSignal('cleanup-started');
            $process->wait();
            $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput());
            $this->assertFileExists($path);
            $this->assertStringEqualsFile($path, $response->getContent());
            $this->assertSame(UploadStatus::Retiring, SandboxFile::query()->sole()->status);
        } finally {
            $connection->commit();
        }
        $service->reclaimUploads(CarbonImmutable::now());
        $this->assertFileDoesNotExist($path);
        $this->assertSame('image/png', getimagesizefromstring($response->getContent())['mime']);
        $this->assertSame(0, SandboxFile::query()->count());
    }
}
