<?php

namespace Tests\Support;

class PortfolioImages
{
    /**
     * @param  int  $width
     * @param  int  $height
     * @param  string  $format
     * @return string
     */
    public static function bytes(int $width = 480, int $height = 600, string $format = 'png'): string
    {
        $image = imagecreatetruecolor($width, $height);
        imagealphablending($image, false);
        imagesavealpha($image, true);
        imagefill($image, 0, 0, imagecolorallocatealpha($image, 237, 228, 246, 0));
        imagefilledellipse($image, (int) ($width * .5), (int) ($height * .45), (int) ($width * .7), (int) ($height * .68), imagecolorallocatealpha($image, 114, 84, 142, 18));
        imagefilledellipse($image, (int) ($width * .6), (int) ($height * .55), (int) ($width * .45), (int) ($height * .45), imagecolorallocatealpha($image, 197, 155, 119, 12));
        ob_start();
        try {
            match ($format) {
                'jpeg' => imagejpeg($image, null, 90),
                'webp' => imagewebp($image, null, 90),
                default => imagepng($image),
            };

            return ob_get_contents();
        } finally {
            ob_end_clean();
            imagedestroy($image);
        }
    }

    /**
     * @param  string  $type
     * @param  string  $data
     * @return string
     */
    public static function pngChunk(string $type, string $data): string
    {
        return pack('N', strlen($data)).$type.$data.hash('crc32b', $type.$data, true);
    }
}
