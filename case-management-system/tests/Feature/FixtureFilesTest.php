<?php

namespace Tests\Feature;

use App\Enums\FixtureFile;
use App\Enums\IllustrationMotif;
use App\Support\Images\IllustrationWriter;
use App\Support\Pdf\TextPdfWriter;
use Illuminate\Support\Facades\File;
use InvalidArgumentException;
use OverflowException;
use PHPUnit\Framework\Attributes\DataProvider;
use RuntimeException;
use Tests\TestCase;

class FixtureFilesTest extends TestCase
{
    private string $directory;

    /**
     * @return void
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->directory = storage_path('framework/testing/fixtures-'.uniqid());
    }

    /**
     * @return void
     */
    protected function tearDown(): void
    {
        File::deleteDirectory($this->directory);

        parent::tearDown();
    }

    /**
     * @return void
     */
    public function test_command_writes_four_files_with_valid_signatures_and_sizes(): void
    {
        $this->artisan('casefile:build-fixtures', ['--directory' => $this->directory])->assertSuccessful();

        $this->assertCount(4, File::files($this->directory));

        foreach (FixtureFile::cases() as $fixture) {
            $path = $this->directory.'/'.$fixture->value;
            $bytes = File::get($path);

            $this->assertGreaterThanOrEqual(1024, strlen($bytes), $fixture->value);

            if ($fixture->mimeType() === 'application/pdf') {
                $this->assertStringStartsWith('%PDF-1.4', $bytes, $fixture->value);
                $this->assertStringEndsWith('%%EOF', $bytes, $fixture->value);
            } else {
                $this->assertStringStartsWith("\x89PNG\r\n\x1a\n", $bytes, $fixture->value);
                $size = getimagesize($path);
                $this->assertNotFalse($size);
                $this->assertSame([1200, 800], [$size[0], $size[1]], $fixture->value);
                $this->assertSame('image/png', $size['mime']);
            }
        }
    }

    /**
     * @return void
     */
    public function test_pdf_cross_reference_table_points_at_every_object(): void
    {
        $this->artisan('casefile:build-fixtures', ['--directory' => $this->directory])->assertSuccessful();

        foreach ([FixtureFile::SnowClearingQuote, FixtureFile::FurnaceFilterInvoice] as $fixture) {
            $bytes = File::get($this->directory.'/'.$fixture->value);

            $this->assertSame(1, preg_match('/startxref\n(\d+)\n%%EOF$/', $bytes, $start));
            $xref = (int) $start[1];
            $this->assertSame("xref\n0 7\n", substr($bytes, $xref, 9));

            for ($object = 1; $object <= 6; $object++) {
                $entry = substr($bytes, $xref + 9 + $object * 20, 20);
                $this->assertSame(1, preg_match('/^(\d{10}) 00000 n \n$/', $entry), $fixture->value.' entry '.$object);
                $this->assertStringStartsWith($object.' 0 obj', substr($bytes, (int) substr($entry, 0, 10)));
            }

            $this->assertSame(1, preg_match('/<< \/Length (\d+) >>\nstream\n(.*)\nendstream/s', $bytes, $stream));
            $this->assertSame((int) $stream[1], strlen($stream[2]));
            $this->assertStringContainsString('/Size 7 /Root 1 0 R', $bytes);
            $this->assertStringContainsString('/Type /Pages /Kids [3 0 R] /Count 1', $bytes);
        }
    }

    /**
     * @return void
     */
    public function test_pdfs_use_helvetica_and_carry_the_case_figures(): void
    {
        $this->artisan('casefile:build-fixtures', ['--directory' => $this->directory])->assertSuccessful();

        $quote = File::get($this->directory.'/'.FixtureFile::SnowClearingQuote->value);
        $invoice = File::get($this->directory.'/'.FixtureFile::FurnaceFilterInvoice->value);

        foreach ([$quote, $invoice] as $bytes) {
            $this->assertStringContainsString('/BaseFont /Helvetica /Encoding /WinAnsiEncoding', $bytes);
            $this->assertStringContainsString('(All amounts are in Canadian dollars.)', $bytes);
            $this->assertSame(0, preg_match('/[^\x0A\x20-\x7E]/', substr($bytes, 15)));
        }

        $this->assertStringContainsString('(Northway Property Management)', $quote);
        $this->assertStringContainsString('($1,740.00)', $quote);
        $this->assertStringContainsString('($1,966.20)', $quote);
        $this->assertStringContainsString('(Optional: fall eavestrough cleaning)', $quote);
        $this->assertStringContainsString('(Dufferin Plumbing)', $invoice);
        $this->assertStringContainsString('(Invoice 2291)', $invoice);
        $this->assertStringContainsString('($226.00)', $invoice);
        $this->assertStringContainsString('\\(13%\\)', $invoice);
    }

    /**
     * @return void
     */
    public function test_command_overwrites_existing_files_and_is_deterministic(): void
    {
        File::ensureDirectoryExists($this->directory);

        foreach (FixtureFile::cases() as $fixture) {
            File::put($this->directory.'/'.$fixture->value, 'stale');
        }

        $this->artisan('casefile:build-fixtures', ['--directory' => $this->directory])->assertSuccessful();

        $first = [];

        foreach (FixtureFile::cases() as $fixture) {
            $first[$fixture->value] = File::hash($this->directory.'/'.$fixture->value);
            $this->assertNotSame('stale', File::get($this->directory.'/'.$fixture->value));
        }

        $this->artisan('casefile:build-fixtures', ['--directory' => $this->directory])->assertSuccessful();

        foreach (FixtureFile::cases() as $fixture) {
            $this->assertSame($first[$fixture->value], File::hash($this->directory.'/'.$fixture->value), $fixture->value);
        }
    }

    /**
     * @return void
     */
    public function test_command_defaults_to_the_configured_directory(): void
    {
        config(['casefile.attachments.directory' => $this->directory]);

        $this->artisan('casefile:build-fixtures')->assertSuccessful();

        foreach (FixtureFile::cases() as $fixture) {
            $this->assertFileExists($fixture->path());
            $this->assertSame($this->directory.DIRECTORY_SEPARATOR.$fixture->value, $fixture->path());
        }
    }

    /**
     * @return void
     */
    public function test_fixture_size_comes_from_disk_and_a_missing_file_fails_loudly(): void
    {
        config(['casefile.attachments.directory' => $this->directory]);

        try {
            FixtureFile::ThermostatError->sizeBytes();
            $this->fail('A missing fixture file must throw.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString($this->directory.DIRECTORY_SEPARATOR.'thermostat-error.png', $exception->getMessage());
        }

        $this->artisan('casefile:build-fixtures')->assertSuccessful();

        $this->assertSame(filesize($this->directory.'/thermostat-error.png'), FixtureFile::ThermostatError->sizeBytes());
    }

    /**
     * @return void
     */
    public function test_definitions_that_miss_a_fixture_fail_before_writing(): void
    {
        $definitions = require database_path('seeders/data/fixtures.php');
        unset($definitions['illustrations'][FixtureFile::ThermostatError->value]);

        File::ensureDirectoryExists($this->directory.'/database/seeders/data');
        File::put($this->directory.'/database/seeders/data/fixtures.php', '<?php return '.var_export($definitions, true).';');
        $this->app->useDatabasePath($this->directory.'/database');

        try {
            $this->artisan('casefile:build-fixtures', ['--directory' => $this->directory.'/out'])->run();
            $this->fail('Definitions missing a fixture must fail.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('must cover exactly', $exception->getMessage());
        }

        $this->assertDirectoryDoesNotExist($this->directory.'/out');
    }

    /**
     * @return void
     */
    public function test_pdf_owner_line_comes_from_the_configured_owner(): void
    {
        config(['casefile.owner.name' => 'Robin Example']);

        $this->artisan('casefile:build-fixtures', ['--directory' => $this->directory])->assertSuccessful();

        $this->assertStringContainsString('(Prepared for: Robin Example)', File::get($this->directory.'/'.FixtureFile::SnowClearingQuote->value));
        $this->assertStringContainsString('(Bill to: Robin Example)', File::get($this->directory.'/'.FixtureFile::FurnaceFilterInvoice->value));
        $this->assertStringNotContainsString(':owner', File::get($this->directory.'/'.FixtureFile::SnowClearingQuote->value));
    }

    /**
     * @return void
     */
    public function test_blank_directory_option_fails_without_writing(): void
    {
        config(['casefile.attachments.directory' => $this->directory]);
        File::ensureDirectoryExists($this->directory);

        foreach (FixtureFile::cases() as $fixture) {
            File::put($fixture->path(), 'untouched');
        }

        foreach ([' ', ''] as $blank) {
            $this->artisan('casefile:build-fixtures', ['--directory' => $blank])
                ->expectsOutputToContain('needs a path')
                ->assertFailed();
        }

        $this->assertFileDoesNotExist(base_path(' '));

        foreach (FixtureFile::cases() as $fixture) {
            $this->assertFileDoesNotExist(base_path(' '.DIRECTORY_SEPARATOR.$fixture->value));
            $this->assertFileDoesNotExist(base_path($fixture->value));
            $this->assertSame('untouched', File::get($fixture->path()), $fixture->value);
        }
    }

    /**
     * @return void
     */
    public function test_pdf_writer_escapes_parentheses_and_backslashes(): void
    {
        $document = new TextPdfWriter('Quote (draft)');
        $document->addLine('Path C:\\files (copy)');

        $bytes = $document->toBytes();

        $this->assertStringContainsString('(Quote \\(draft\\)) Tj', $bytes);
        $this->assertStringContainsString('(Path C:\\\\files \\(copy\\)) Tj', $bytes);
        $this->assertStringContainsString('/Title (Quote \\(draft\\))', $bytes);
    }

    /**
     * @return void
     */
    public function test_pdf_writer_right_aligns_the_column_after_a_tab(): void
    {
        $document = new TextPdfWriter('Totals');
        $document->addLine("Total\t$1.00");

        $this->assertStringContainsString('BT /F1 11 Tf 72.00 668 Td (Total) Tj ET', $document->toBytes());
        $this->assertStringContainsString('BT /F1 11 Tf 512.48 668 Td ($1.00) Tj ET', $document->toBytes());
    }

    /**
     * @return array<string, array{string}>
     */
    public static function unprintableLines(): array
    {
        return [
            'accented letter' => ["Caf\u{e9}"],
            'smart quote' => ["Dana\u{2019}s"],
            'emoji' => ["Leak \u{1F4A7}"],
            'newline' => ["one\ntwo"],
            'trailing newline' => ["Total\n"],
            'carriage return' => ["one\rtwo"],
            'two tabs' => ["a\tb\tc"],
            'nul byte' => ["a\0b"],
        ];
    }

    /**
     * @param  string  $line
     * @return void
     */
    #[DataProvider('unprintableLines')]
    public function test_pdf_writer_rejects_text_it_cannot_encode(string $line): void
    {
        $document = new TextPdfWriter('Title');

        $this->expectException(InvalidArgumentException::class);

        $document->addLine($line);
    }

    /**
     * @return void
     */
    public function test_pdf_writer_rejects_an_unprintable_title(): void
    {
        $this->expectException(InvalidArgumentException::class);

        new TextPdfWriter("Caf\u{e9}");
    }

    /**
     * @return void
     */
    public function test_pdf_writer_accepts_a_line_that_just_fits_and_rejects_one_that_does_not(): void
    {
        $document = new TextPdfWriter('Widths');
        $document->addLine(str_repeat('i', 191));

        $this->assertStringContainsString(str_repeat('i', 191), $document->toBytes());

        $this->expectException(InvalidArgumentException::class);

        $document->addLine(str_repeat('i', 192));
    }

    /**
     * @return void
     */
    public function test_pdf_writer_counts_the_column_gap_in_a_two_column_line(): void
    {
        $document = new TextPdfWriter('Widths');
        $document->addLine(str_repeat('i', 188));
        $document->addLine(str_repeat('i', 93)."\t".str_repeat('i', 93));

        $this->expectException(InvalidArgumentException::class);

        $document->addLine(str_repeat('i', 94)."\t".str_repeat('i', 94));
    }

    /**
     * @return void
     */
    public function test_pdf_writer_rejects_a_title_wider_than_the_page(): void
    {
        $this->expectException(InvalidArgumentException::class);

        new TextPdfWriter(str_repeat('W', 25));
    }

    /**
     * @return void
     */
    public function test_pdf_writer_holds_thirty_eight_lines_and_refuses_the_thirty_ninth(): void
    {
        $document = new TextPdfWriter('Full page');

        for ($line = 1; $line <= 38; $line++) {
            $document->addLine('Line '.$line);
        }

        $this->assertStringContainsString('BT /F1 11 Tf 72.00 76 Td (Line 38) Tj ET', $document->toBytes());

        $this->expectException(OverflowException::class);

        $document->addLine('Line 39');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function badAccents(): array
    {
        return [
            'named colour' => ['blue'],
            'short hex' => ['#abc'],
            'no hash' => ['2f6f9f'],
            'bad digit' => ['#2f6f9g'],
            'trailing text' => ["#2f6f9f\n"],
        ];
    }

    /**
     * @param  string  $accent
     * @return void
     */
    #[DataProvider('badAccents')]
    public function test_illustration_writer_rejects_a_bad_accent(string $accent): void
    {
        $this->expectException(InvalidArgumentException::class);

        (new IllustrationWriter)->write($this->directory.'/never.png', 'Caption', $accent, IllustrationMotif::Thermostat);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function badCaptions(): array
    {
        return [
            'empty' => [''],
            'accented letter' => ["Caf\u{e9}"],
            'newline' => ["one\ntwo"],
            'trailing newline' => ["Caption\n"],
            'too wide for the image' => [str_repeat('A', 41)],
        ];
    }

    /**
     * @param  string  $caption
     * @return void
     */
    #[DataProvider('badCaptions')]
    public function test_illustration_writer_rejects_a_bad_caption(string $caption): void
    {
        $this->expectException(InvalidArgumentException::class);

        (new IllustrationWriter)->write($this->directory.'/never.png', $caption, '#2f6f9f', IllustrationMotif::KitchenSink);
    }

    /**
     * @return void
     */
    public function test_illustration_writer_accepts_a_caption_of_forty_characters(): void
    {
        File::ensureDirectoryExists($this->directory);
        $path = $this->directory.'/wide.png';

        (new IllustrationWriter)->write($path, str_repeat('A', 40), '#2f6f9f', IllustrationMotif::KitchenSink);

        $this->assertSame([1200, 800], array_slice(getimagesize($path) ?: [], 0, 2));
    }

    /**
     * @return void
     */
    public function test_the_two_illustrations_differ(): void
    {
        $this->artisan('casefile:build-fixtures', ['--directory' => $this->directory])->assertSuccessful();

        $this->assertNotSame(
            File::hash($this->directory.'/'.FixtureFile::KitchenSinkLeak->value),
            File::hash($this->directory.'/'.FixtureFile::ThermostatError->value),
        );
    }
}
