<?php

namespace App\Support\Pdf;

use InvalidArgumentException;
use OverflowException;

final class TextPdfWriter
{
    private const int PAGE_WIDTH = 612;

    private const int PAGE_HEIGHT = 792;

    private const int MARGIN = 72;

    private const int TITLE_SIZE = 20;

    private const int BODY_SIZE = 11;

    private const int LEADING = 16;

    private const int COLUMN_GAP = 12;

    private const int TITLE_BASELINE = self::PAGE_HEIGHT - self::MARGIN - self::TITLE_SIZE;

    private const int RULE_Y = self::TITLE_BASELINE - 10;

    private const int FIRST_BASELINE = self::TITLE_BASELINE - 32;

    private const int TEXT_WIDTH = self::PAGE_WIDTH - 2 * self::MARGIN;

    private const array HELVETICA_WIDTHS = [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
        1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
        333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
        556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
    ];

    /** @var list<string> */
    private array $lines = [];

    /**
     * @param  string  $title
     *
     * @throws InvalidArgumentException
     */
    public function __construct(private readonly string $title)
    {
        $this->assertPrintable($title);

        if ($this->widthOf($title, self::TITLE_SIZE) > self::TEXT_WIDTH) {
            throw new InvalidArgumentException('PDF title is wider than the page: '.$title);
        }
    }

    /**
     * @param  string  $text
     * @return void
     *
     * @throws InvalidArgumentException
     * @throws OverflowException
     */
    public function addLine(string $text): void
    {
        $segments = explode("\t", $text);

        if (count($segments) > 2) {
            throw new InvalidArgumentException('A PDF line takes at most one tab: '.$text);
        }

        $width = (count($segments) - 1) * self::COLUMN_GAP;

        foreach ($segments as $segment) {
            $this->assertPrintable($segment);
            $width += $this->widthOf($segment, self::BODY_SIZE);
        }

        if ($width > self::TEXT_WIDTH) {
            throw new InvalidArgumentException('PDF line is wider than the page: '.$text);
        }

        if (self::FIRST_BASELINE - count($this->lines) * self::LEADING < self::MARGIN) {
            throw new OverflowException('The PDF page is full at '.count($this->lines).' lines.');
        }

        $this->lines[] = $text;
    }

    /**
     * @return string
     */
    public function toBytes(): string
    {
        $operations = [
            $this->textAt(self::TITLE_SIZE, self::MARGIN, self::TITLE_BASELINE, $this->title),
            sprintf('0.6 0.6 0.6 RG 0.75 w %d %d m %d %d l S', self::MARGIN, self::RULE_Y, self::PAGE_WIDTH - self::MARGIN, self::RULE_Y),
        ];

        foreach ($this->lines as $index => $line) {
            $baseline = self::FIRST_BASELINE - $index * self::LEADING;
            $segments = explode("\t", $line);

            if ($segments[0] !== '') {
                $operations[] = $this->textAt(self::BODY_SIZE, self::MARGIN, $baseline, $segments[0]);
            }

            if (count($segments) === 2 && $segments[1] !== '') {
                $left = self::PAGE_WIDTH - self::MARGIN - $this->widthOf($segments[1], self::BODY_SIZE);
                $operations[] = $this->textAt(self::BODY_SIZE, $left, $baseline, $segments[1]);
            }
        }

        $content = implode("\n", $operations);

        $objects = [
            '<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            sprintf(
                '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
                self::PAGE_WIDTH,
                self::PAGE_HEIGHT,
            ),
            '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
            sprintf("<< /Length %d >>\nstream\n%s\nendstream", strlen($content), $content),
            sprintf('<< /Title %s /Producer (Casefile demo fixtures) >>', $this->literal($this->title)),
        ];

        $bytes = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];

        foreach ($objects as $index => $object) {
            $offsets[] = strlen($bytes);
            $bytes .= sprintf("%d 0 obj\n%s\nendobj\n", $index + 1, $object);
        }

        $xref = strlen($bytes);
        $bytes .= sprintf("xref\n0 %d\n0000000000 65535 f \n", count($objects) + 1);

        foreach ($offsets as $offset) {
            $bytes .= sprintf("%010d 00000 n \n", $offset);
        }

        return $bytes.sprintf(
            "trailer\n<< /Size %d /Root 1 0 R /Info %d 0 R >>\nstartxref\n%d\n%%%%EOF",
            count($objects) + 1,
            count($objects),
            $xref,
        );
    }

    /**
     * @param  int  $size
     * @param  float  $left
     * @param  int  $baseline
     * @param  string  $text
     * @return string
     */
    private function textAt(int $size, float $left, int $baseline, string $text): string
    {
        return sprintf('BT /F1 %d Tf %.2F %d Td %s Tj ET', $size, $left, $baseline, $this->literal($text));
    }

    /**
     * @param  string  $text
     * @return string
     */
    private function literal(string $text): string
    {
        return '('.strtr($text, ['\\' => '\\\\', '(' => '\\(', ')' => '\\)']).')';
    }

    /**
     * @param  string  $text
     * @param  int  $size
     * @return float
     */
    private function widthOf(string $text, int $size): float
    {
        $units = 0;

        foreach (str_split($text) as $character) {
            $units += self::HELVETICA_WIDTHS[ord($character) - 32];
        }

        return $units * $size / 1000;
    }

    /**
     * @param  string  $text
     * @return void
     *
     * @throws InvalidArgumentException
     */
    private function assertPrintable(string $text): void
    {
        if (preg_match('/^[\x20-\x7E]*$/D', $text) !== 1) {
            throw new InvalidArgumentException('PDF text must be printable ASCII: '.$text);
        }
    }
}
