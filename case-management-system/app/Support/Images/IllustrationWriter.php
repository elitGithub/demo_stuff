<?php

namespace App\Support\Images;

use App\Enums\IllustrationMotif;
use GdImage;
use InvalidArgumentException;
use RuntimeException;

final class IllustrationWriter
{
    private const int WIDTH = 1200;

    private const int HEIGHT = 800;

    private const int FONT = 5;

    private const int INSET = 60;

    private const int BAND_TOP = 650;

    private const int CAPTION_SCALE = 3;

    private const int FOOTER_SCALE = 2;

    private const string FOOTER = 'Illustrative image';

    private const array WHITE = [255, 255, 255];

    private const array INK = [31, 41, 51];

    private const array MUTED = [98, 108, 120];

    private const array STEEL = [176, 184, 193];

    private const array STEEL_DARK = [120, 129, 140];

    private const array WOOD = [214, 196, 170];

    private const array WOOD_DARK = [176, 152, 120];

    private const array CABINET_INTERIOR = [70, 62, 54];

    private const array COUNTERTOP = [205, 199, 190];

    private const array COUNTERTOP_EDGE = [168, 160, 150];

    private const array BUCKET = [214, 120, 66];

    private const array BUCKET_RIM = [176, 92, 48];

    private const array PLATE = [248, 248, 246];

    private const array DISPLAY_LABEL = [150, 160, 170];

    private const array BUTTON_FACE = [228, 230, 233];

    /**
     * @param  string  $path
     * @param  string  $caption
     * @param  string  $accentHex
     * @param  IllustrationMotif  $motif
     * @return void
     *
     * @throws InvalidArgumentException
     * @throws RuntimeException
     */
    public function write(string $path, string $caption, string $accentHex, IllustrationMotif $motif): void
    {
        if (preg_match('/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/D', $accentHex, $channels) !== 1) {
            throw new InvalidArgumentException('Accent must be a #rrggbb colour: '.$accentHex);
        }

        if (preg_match('/^[\x20-\x7E]+$/D', $caption) !== 1) {
            throw new InvalidArgumentException('Caption must be printable ASCII: '.$caption);
        }

        if (strlen($caption) * imagefontwidth(self::FONT) * self::CAPTION_SCALE > self::WIDTH - 2 * self::INSET) {
            throw new InvalidArgumentException('Caption is wider than the image: '.$caption);
        }

        $accent = [hexdec($channels[1]), hexdec($channels[2]), hexdec($channels[3])];
        $image = imagecreatetruecolor(self::WIDTH, self::HEIGHT);

        if ($image === false) {
            throw new RuntimeException('GD could not create a '.self::WIDTH.' by '.self::HEIGHT.' image.');
        }

        $top = $this->blend(self::WHITE, $accent, 0.14);
        $bottom = $this->blend(self::WHITE, $accent, 0.38);

        for ($row = 0; $row < self::HEIGHT; $row++) {
            imageline($image, 0, $row, self::WIDTH - 1, $row, $this->colour($image, $this->blend($top, $bottom, $row / (self::HEIGHT - 1))));
        }

        $ink = $this->colour($image, self::INK);
        $steel = $this->colour($image, self::STEEL);
        $steelDark = $this->colour($image, self::STEEL_DARK);
        $accentColour = $this->colour($image, $accent);
        $accentLight = $this->colour($image, $this->blend(self::WHITE, $accent, 0.45));
        $accentDark = $this->colour($image, $this->blend($accent, self::INK, 0.35));

        $drawMotif = match ($motif) {
            IllustrationMotif::KitchenSink => function () use ($image, $ink, $steel, $steelDark, $accentColour, $accentLight, $accentDark, $accent): void {
                $grout = $this->colour($image, $this->blend(self::WHITE, $accent, 0.24));
                $tile = $this->colour($image, $this->blend(self::WHITE, $accent, 0.06));
                $wood = $this->colour($image, self::WOOD);
                $woodDark = $this->colour($image, self::WOOD_DARK);
                $interior = $this->colour($image, self::CABINET_INTERIOR);
                $bucket = $this->colour($image, self::BUCKET);
                $bucketRim = $this->colour($image, self::BUCKET_RIM);

                imagefilledrectangle($image, 200, 90, 1000, 300, $grout);

                for ($tileTop = 94, $course = 0; $tileTop < 300; $tileTop += 44, $course++) {
                    for ($tileLeft = 204 - ($course % 2) * 42; $tileLeft < 1000; $tileLeft += 84) {
                        imagefilledrectangle($image, max($tileLeft, 204), $tileTop, min($tileLeft + 79, 996), min($tileTop + 39, 299), $tile);
                    }
                }

                $this->fillRoundedRectangle($image, 580, 250, 620, 304, 8, $steel);
                imagefilledrectangle($image, 592, 170, 608, 250, $steel);
                imagefilledrectangle($image, 520, 160, 608, 178, $steel);
                imagefilledrectangle($image, 520, 160, 536, 196, $steel);
                imagefilledellipse($image, 652, 282, 44, 22, $steelDark);

                $this->fillRoundedRectangle($image, 180, 300, 1020, 340, 8, $this->colour($image, self::COUNTERTOP));
                imagefilledrectangle($image, 180, 332, 1020, 340, $this->colour($image, self::COUNTERTOP_EDGE));

                imagefilledrectangle($image, 220, 340, 980, 620, $wood);
                imagefilledrectangle($image, 260, 370, 940, 600, $interior);
                imagefilledrectangle($image, 260, 592, 940, 600, $woodDark);
                imagefilledpolygon($image, [260, 366, 150, 388, 150, 616, 260, 604], $wood);
                imagefilledpolygon($image, [940, 366, 1050, 388, 1050, 616, 940, 604], $wood);
                $this->fillRoundedRectangle($image, 166, 470, 178, 530, 5, $woodDark);
                $this->fillRoundedRectangle($image, 1022, 470, 1034, 530, 5, $woodDark);

                imagefilledellipse($image, 640, 450, 122, 100, $steel);
                imagefilledellipse($image, 640, 450, 78, 56, $interior);
                imagefilledrectangle($image, 579, 370, 701, 450, $interior);
                imagefilledrectangle($image, 579, 340, 601, 450, $steel);
                imagefilledrectangle($image, 679, 409, 701, 450, $steel);
                imagefilledrectangle($image, 679, 409, 930, 431, $steel);
                imagefilledrectangle($image, 880, 404, 900, 436, $steelDark);
                imagefilledrectangle($image, 930, 396, 940, 444, $steelDark);

                imagefilledellipse($image, 830, 594, 300, 22, $accentLight);
                imagefilledpolygon($image, [845, 545, 965, 545, 950, 600, 860, 600], $bucket);
                imagefilledrectangle($image, 840, 538, 970, 548, $bucketRim);
                imagefilledellipse($image, 890, 456, 14, 20, $accentColour);
                imagefilledellipse($image, 890, 492, 12, 18, $accentColour);
                imagefilledellipse($image, 890, 524, 10, 15, $accentDark);
                imagefilledellipse($image, 760, 596, 60, 10, $accentColour);
                imagefilledrectangle($image, 0, 620, self::WIDTH - 1, self::BAND_TOP - 1, $this->colour($image, $this->blend(self::WHITE, self::INK, 0.12)));
                imagefilledrectangle($image, 220, 612, 980, 620, $ink);
            },
            IllustrationMotif::Thermostat => function () use ($image, $ink, $steel, $steelDark, $accentColour, $bottom): void {
                $this->fillRoundedRectangle($image, 432, 124, 792, 604, 40, $this->colour($image, $this->blend($bottom, self::INK, 0.18)));
                $this->fillRoundedRectangle($image, 420, 110, 780, 590, 40, $this->colour($image, self::PLATE));
                $this->fillRoundedRectangle($image, 465, 160, 735, 360, 18, $ink);
                $this->drawText($image, 'HEAT', 488, 178, 2, $this->colour($image, self::DISPLAY_LABEL));
                imagefilledpolygon($image, [690, 204, 707, 174, 724, 204], $accentColour);
                $this->drawText($image, 'E4', 528, 222, 8, $accentColour);

                foreach ([540, 660] as $centre) {
                    imagefilledellipse($image, $centre, 450, 78, 78, $steel);
                    imagefilledellipse($image, $centre, 450, 68, 68, $this->colour($image, self::BUTTON_FACE));
                    imagefilledrectangle($image, $centre - 15, 446, $centre + 15, 454, $steelDark);
                }

                imagefilledrectangle($image, 656, 435, 664, 465, $steelDark);
                imagefilledellipse($image, 600, 540, 18, 18, $accentColour);
            },
        };

        $drawMotif();

        imagefilledrectangle($image, 0, self::BAND_TOP, self::WIDTH - 1, self::HEIGHT - 1, $this->colour($image, $this->blend(self::WHITE, $accent, 0.05)));
        imagefilledrectangle($image, 0, self::BAND_TOP, self::WIDTH - 1, self::BAND_TOP + 3, $accentColour);
        $this->drawText($image, $caption, self::INSET, self::BAND_TOP + 26, self::CAPTION_SCALE, $ink);
        $this->drawText($image, self::FOOTER, self::INSET, self::BAND_TOP + 88, self::FOOTER_SCALE, $this->colour($image, self::MUTED));

        if (! imagepng($image, $path)) {
            throw new RuntimeException('Could not write the illustration to '.$path);
        }
    }

    /**
     * @param  GdImage  $image
     * @param  string  $text
     * @param  int  $left
     * @param  int  $top
     * @param  int  $scale
     * @param  int  $colour
     * @return void
     *
     * @throws RuntimeException
     */
    private function drawText(GdImage $image, string $text, int $left, int $top, int $scale, int $colour): void
    {
        $glyphHeight = imagefontheight(self::FONT);
        $stamp = imagecreatetruecolor(imagefontwidth(self::FONT) * strlen($text), $glyphHeight);

        if ($stamp === false) {
            throw new RuntimeException('GD could not create a text stamp for '.$text);
        }

        imagestring($stamp, self::FONT, 0, 0, $text, $this->colour($stamp, self::WHITE));

        for ($column = 0; $column < imagesx($stamp); $column++) {
            for ($row = 0; $row < $glyphHeight; $row++) {
                if (imagecolorat($stamp, $column, $row) !== 0) {
                    imagefilledrectangle(
                        $image,
                        $left + $column * $scale,
                        $top + $row * $scale,
                        $left + ($column + 1) * $scale - 1,
                        $top + ($row + 1) * $scale - 1,
                        $colour,
                    );
                }
            }
        }
    }

    /**
     * @param  GdImage  $image
     * @param  int  $left
     * @param  int  $top
     * @param  int  $right
     * @param  int  $bottom
     * @param  int  $radius
     * @param  int  $colour
     * @return void
     */
    private function fillRoundedRectangle(GdImage $image, int $left, int $top, int $right, int $bottom, int $radius, int $colour): void
    {
        imagefilledrectangle($image, $left + $radius, $top, $right - $radius, $bottom, $colour);
        imagefilledrectangle($image, $left, $top + $radius, $right, $bottom - $radius, $colour);

        foreach ([[$left + $radius, $top + $radius], [$right - $radius, $top + $radius], [$left + $radius, $bottom - $radius], [$right - $radius, $bottom - $radius]] as [$centreX, $centreY]) {
            imagefilledellipse($image, $centreX, $centreY, $radius * 2, $radius * 2, $colour);
        }
    }

    /**
     * @param  GdImage  $image
     * @param  array{0: int|float, 1: int|float, 2: int|float}  $rgb
     * @return int
     */
    private function colour(GdImage $image, array $rgb): int
    {
        return imagecolorallocate($image, (int) round($rgb[0]), (int) round($rgb[1]), (int) round($rgb[2]));
    }

    /**
     * @param  array{0: int|float, 1: int|float, 2: int|float}  $from
     * @param  array{0: int|float, 1: int|float, 2: int|float}  $to
     * @param  float  $ratio
     * @return array{0: float, 1: float, 2: float}
     */
    private function blend(array $from, array $to, float $ratio): array
    {
        return [
            $from[0] + ($to[0] - $from[0]) * $ratio,
            $from[1] + ($to[1] - $from[1]) * $ratio,
            $from[2] + ($to[2] - $from[2]) * $ratio,
        ];
    }
}
