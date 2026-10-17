<?php

namespace Tests\Feature;

use App\Enums\FixtureFile;
use App\Mailbox\AttachmentDelivery;
use App\Models\Attachment;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Tests\TestCase;

class AttachmentDeliveryTest extends TestCase
{
    use RefreshDatabase;

    private const string SANDBOXED = "sandbox; default-src 'none'";

    private const string PDF = "default-src 'none'";

    /**
     * @return array<string, array{string}>
     */
    public static function downloadOnlyTypes(): array
    {
        return [
            'html' => ['text/html'],
            'html with a charset' => ['text/html; charset=utf-8'],
            'svg' => ['image/svg+xml'],
            'xhtml' => ['application/xhtml+xml'],
            'javascript' => ['text/javascript'],
            'xml' => ['application/xml'],
            'generic binary' => ['application/octet-stream'],
            'empty' => [''],
            'allowed type as a prefix only' => ['image/pngx'],
            'allowed type as a suffix only' => ['ximage/png'],
            'pdf as a prefix only' => ['application/pdfx'],
        ];
    }

    /**
     * @return array<string, array{string, string, string}>
     */
    public static function inlineSpellings(): array
    {
        return [
            'png' => ['image/png', 'image/png', self::SANDBOXED],
            'jpeg' => ['image/jpeg', 'image/jpeg', self::SANDBOXED],
            'gif' => ['image/gif', 'image/gif', self::SANDBOXED],
            'webp' => ['image/webp', 'image/webp', self::SANDBOXED],
            'plain text' => ['text/plain', 'text/plain', self::SANDBOXED],
            'pdf' => ['application/pdf', 'application/pdf', self::PDF],
            'upper case' => ['IMAGE/PNG', 'image/png', self::SANDBOXED],
            'padded' => ['  image/png  ', 'image/png', self::SANDBOXED],
            'pdf with a parameter' => ['Application/PDF; version=1.4', 'application/pdf', self::PDF],
            'header break in a parameter' => ["image/png; x=1\r\nSet-Cookie: stolen=1", 'image/png', self::SANDBOXED],
        ];
    }

    /**
     * @return array<string, array{string}>
     */
    public static function escapingPaths(): array
    {
        return [
            'parent directories to the project root' => ['../../../composer.json'],
            'parent directories to the seeders' => ['../../seeders/DatabaseSeeder.php'],
        ];
    }

    /**
     * @see config/casefile.php
     */
    public function test_the_inline_allowlist_lives_in_config(): void
    {
        $this->assertSame(
            ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'],
            config('casefile.attachments.inline_types'),
        );
    }

    /**
     * @see AttachmentDelivery::for()
     */
    #[DataProvider('inlineSpellings')]
    public function test_an_allowed_type_is_inline_with_its_clean_type_and_policy(string $mimeType, string $type, string $policy): void
    {
        $response = (new AttachmentDelivery)->for($this->attachment($mimeType, FixtureFile::ThermostatError->value));

        $this->assertTrue($response->inline);
        $this->assertSame($type, $response->contentType);
        $this->assertSame(FixtureFile::ThermostatError->path(), $response->path);
        $this->assertSame(['X-Content-Type-Options' => 'nosniff', 'Content-Security-Policy' => $policy], $response->headers);
    }

    /**
     * @see AttachmentDelivery::for()
     */
    #[DataProvider('downloadOnlyTypes')]
    public function test_a_type_outside_the_allowlist_becomes_a_sandboxed_download(string $mimeType): void
    {
        $response = (new AttachmentDelivery)->for($this->attachment($mimeType, FixtureFile::ThermostatError->value));

        $this->assertFalse($response->inline);
        $this->assertSame('application/octet-stream', $response->contentType);
        $this->assertSame(['X-Content-Type-Options' => 'nosniff', 'Content-Security-Policy' => self::SANDBOXED], $response->headers);
    }

    /**
     * @see AttachmentDelivery::for()
     */
    public function test_a_type_removed_from_the_allowlist_stops_rendering_inline(): void
    {
        config(['casefile.attachments.inline_types' => ['image/png']]);

        $response = (new AttachmentDelivery)->for($this->attachment('application/pdf', FixtureFile::FurnaceFilterInvoice->value));

        $this->assertFalse($response->inline);
        $this->assertSame('application/octet-stream', $response->contentType);
        $this->assertSame(self::SANDBOXED, $response->headers['Content-Security-Policy']);
    }

    /**
     * @see AttachmentDelivery::for()
     */
    public function test_a_missing_file_is_not_found(): void
    {
        $this->expectException(NotFoundHttpException::class);

        (new AttachmentDelivery)->for($this->attachment('image/png', 'never-built.png'));
    }

    /**
     * @see AttachmentDelivery::for()
     */
    #[DataProvider('escapingPaths')]
    public function test_a_stored_path_cannot_reach_outside_the_attachments_directory(string $storagePath): void
    {
        $this->assertFileExists(config('casefile.attachments.directory').'/'.$storagePath);
        $this->expectException(NotFoundHttpException::class);

        (new AttachmentDelivery)->for($this->attachment('text/plain', $storagePath));
    }

    /**
     * @see AttachmentDelivery::for()
     */
    public function test_an_absolute_stored_path_is_not_followed(): void
    {
        $this->assertFileExists(base_path('composer.json'));
        $this->expectException(NotFoundHttpException::class);

        (new AttachmentDelivery)->for($this->attachment('text/plain', base_path('composer.json')));
    }

    /**
     * @param  string  $mimeType
     * @param  string  $storagePath
     * @return Attachment
     */
    private function attachment(string $mimeType, string $storagePath): Attachment
    {
        return Attachment::factory()->make(['mime_type' => $mimeType, 'storage_path' => $storagePath]);
    }
}
