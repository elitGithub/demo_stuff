<?php

namespace App\Console\Commands;

use App\Enums\FixtureFile;
use App\Support\Images\IllustrationWriter;
use App\Support\Pdf\TextPdfWriter;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;
use InvalidArgumentException;
use OverflowException;
use RuntimeException;

#[Signature('casefile:build-fixtures {--directory= : Directory to write the attachment files into (default: the configured attachments directory)}')]
#[Description('Write the demo attachment files: two PDFs and two illustrations, overwriting any existing copies')]
class BuildFixturesCommand extends Command
{
    /**
     * @param  IllustrationWriter  $illustrations
     * @return int
     *
     * @throws InvalidArgumentException
     * @throws OverflowException
     * @throws RuntimeException
     */
    public function handle(IllustrationWriter $illustrations): int
    {
        $directory = $this->option('directory') ?? config('casefile.attachments.directory');

        if (! is_string($directory) || trim($directory) === '') {
            $this->components->error('The --directory option needs a path.');

            return self::FAILURE;
        }

        $fixtures = require database_path('seeders/data/fixtures.php');
        $defined = array_merge(array_keys($fixtures['documents']), array_keys($fixtures['illustrations']));
        $expected = array_column(FixtureFile::cases(), 'value');
        sort($defined);
        sort($expected);

        if ($defined !== $expected) {
            throw new RuntimeException('The fixture definitions must cover exactly: '.implode(', ', $expected).'.');
        }

        $directory = rtrim($directory, DIRECTORY_SEPARATOR);
        $owner = config('casefile.owner.name');
        File::ensureDirectoryExists($directory);

        foreach ($fixtures['documents'] as $filename => $definition) {
            $document = new TextPdfWriter($definition['title']);

            foreach ($definition['lines'] as $line) {
                $document->addLine(strtr($line, [':owner' => $owner]));
            }

            File::put($directory.DIRECTORY_SEPARATOR.$filename, $document->toBytes());
        }

        foreach ($fixtures['illustrations'] as $filename => $definition) {
            $illustrations->write($directory.DIRECTORY_SEPARATOR.$filename, $definition['caption'], $definition['accent'], $definition['motif']);
        }

        foreach (FixtureFile::cases() as $fixture) {
            $path = $directory.DIRECTORY_SEPARATOR.$fixture->value;
            $this->components->twoColumnDetail($path, number_format(File::size($path)).' bytes');
        }

        $this->components->info(sprintf('Wrote %d attachment files to %s.', count(FixtureFile::cases()), $directory));

        return self::SUCCESS;
    }
}
