<?php

namespace Tests\Feature;

use App\Enums\FixtureFile;
use App\Models\Attachment;
use App\Models\CaseMessage;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AttachmentAccessTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->seed();
        $this->actingAs(User::query()->findOrFail(1));
    }

    /**
     * @return array<string, array{FixtureFile, string}>
     */
    public static function fixtures(): array
    {
        return [
            'snow clearing quote' => [FixtureFile::SnowClearingQuote, "default-src 'none'"],
            'furnace filter invoice' => [FixtureFile::FurnaceFilterInvoice, "default-src 'none'"],
            'kitchen sink photo' => [FixtureFile::KitchenSinkLeak, "sandbox; default-src 'none'"],
            'thermostat photo' => [FixtureFile::ThermostatError, "sandbox; default-src 'none'"],
        ];
    }

    /**
     * @see App\Http\Controllers\AttachmentController::show()
     */
    #[DataProvider('fixtures')]
    public function test_each_seeded_attachment_streams_its_fixture_bytes_name_type_and_policy(FixtureFile $fixture, string $policy): void
    {
        $attachment = Attachment::query()->where('filename', $fixture->value)->firstOrFail();

        $response = $this->get(route('attachments.show', $attachment))->assertOk();

        $this->assertSame(file_get_contents($fixture->path()), $this->body($response));
        $this->assertSame($fixture->mimeType(), $response->headers->get('Content-Type'));
        $this->assertSame('inline; filename='.$fixture->value, $response->headers->get('Content-Disposition'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $this->assertSame($policy, $response->headers->get('Content-Security-Policy'));
    }

    /**
     * @see App\Http\Controllers\AttachmentController::show()
     */
    public function test_a_png_is_sandboxed_and_a_pdf_keeps_its_viewer(): void
    {
        $png = $this->get(route('attachments.show', Attachment::query()->where('mime_type', 'image/png')->firstOrFail()))->assertOk();
        $pdf = $this->get(route('attachments.show', Attachment::query()->where('mime_type', 'application/pdf')->firstOrFail()))->assertOk();

        $this->assertSame("sandbox; default-src 'none'", $png->headers->get('Content-Security-Policy'));
        $this->assertSame("default-src 'none'", $pdf->headers->get('Content-Security-Policy'));
        $this->assertStringNotContainsString('sandbox', $pdf->headers->get('Content-Security-Policy'));
    }

    /**
     * @see App\Http\Controllers\AttachmentController::show()
     */
    public function test_an_html_attachment_is_downloaded_as_binary_under_the_sandbox(): void
    {
        $attachment = $this->storedAttachment('notice.html', 'text/html');

        $response = $this->get(route('attachments.show', $attachment))->assertOk();

        $this->assertSame('application/octet-stream', $response->headers->get('Content-Type'));
        $this->assertSame('attachment; filename=notice.html', $response->headers->get('Content-Disposition'));
        $this->assertSame('nosniff', $response->headers->get('X-Content-Type-Options'));
        $this->assertSame("sandbox; default-src 'none'", $response->headers->get('Content-Security-Policy'));
        $this->assertSame(file_get_contents(FixtureFile::ThermostatError->path()), $this->body($response));
    }

    /**
     * @see App\Http\Controllers\AttachmentController::show()
     */
    public function test_the_stored_filename_wins_over_the_file_on_disk(): void
    {
        $attachment = $this->storedAttachment('Thermostat photo, unit 2B.png', 'image/png');

        $response = $this->get(route('attachments.show', $attachment))->assertOk();

        $this->assertSame(file_get_contents(FixtureFile::ThermostatError->path()), $this->body($response));
        $this->assertSame('inline; filename="Thermostat photo, unit 2B.png"', $response->headers->get('Content-Disposition'));
    }

    /**
     * @see routes/web.php
     */
    public function test_a_missing_attachment_row_is_not_found(): void
    {
        $missing = Attachment::query()->max('id') + 1;

        $this->get('/attachments/'.$missing)->assertNotFound();
        $this->get('/attachments/0')->assertNotFound();
        $this->get('/attachments/thermostat-error.png')->assertNotFound();
    }

    /**
     * @see App\Mailbox\AttachmentDelivery::for()
     */
    public function test_a_row_whose_file_is_gone_is_not_found(): void
    {
        $attachment = Attachment::factory()->create(['storage_path' => 'never-built.pdf']);

        $this->assertFileDoesNotExist(config('casefile.attachments.directory').'/never-built.pdf');

        $this->get(route('attachments.show', $attachment))->assertNotFound();
    }

    /**
     * @see App\Mailbox\AttachmentDelivery::for()
     */
    public function test_a_stored_path_cannot_reach_outside_the_attachments_directory(): void
    {
        $attachment = Attachment::factory()->create(['storage_path' => '../../../composer.json']);

        $this->assertFileExists(config('casefile.attachments.directory').'/../../../composer.json');

        $this->get(route('attachments.show', $attachment))->assertNotFound();
    }

    /**
     * @see routes/web.php
     */
    public function test_a_guest_cannot_read_an_attachment(): void
    {
        $attachment = Attachment::query()->firstOrFail();
        $this->app['auth']->forgetGuards();

        $this->get(route('attachments.show', $attachment))->assertRedirect('/sign-in');
    }

    /**
     * @param  string  $filename
     * @param  string  $mimeType
     * @return Attachment
     */
    private function storedAttachment(string $filename, string $mimeType): Attachment
    {
        return CaseMessage::query()->firstOrFail()->attachments()->create([
            'filename' => $filename,
            'mime_type' => $mimeType,
            'size_bytes' => 10,
            'storage_path' => FixtureFile::ThermostatError->value,
        ]);
    }

    /**
     * @param  TestResponse  $response
     * @return string
     */
    private function body(TestResponse $response): string
    {
        ob_start();
        $response->baseResponse->sendContent();

        return (string) ob_get_clean();
    }
}
