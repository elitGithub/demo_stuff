<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Http\UploadedFile;

class DecodableImage implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! $value instanceof UploadedFile || ! $value->isValid()
            || $value->getSize() > config('marketplace.photo_max_kilobytes') * 1024) {
            $fail('Upload a complete JPEG, PNG or WebP image.');

            return;
        }
        $dimensions = @getimagesize($value->getRealPath());
        if (! $dimensions || $dimensions[0] < 1 || $dimensions[1] < 1
            || $dimensions[0] > 4096 || $dimensions[1] > 4096) {
            $fail('The photo must be no larger than 4096 pixels in either direction.');

            return;
        }
        // Bound decoder memory before allocating pixels, including GD overhead.
        $required = $dimensions[0] * $dimensions[1] * 6 + $value->getSize() * 2 + 16 * 1024 * 1024;
        $limit = ini_parse_quantity(ini_get('memory_limit'));
        if ($limit > 0 && memory_get_usage(true) + $required > $limit) {
            $fail('This photo is too large to process. Please upload a smaller image.');

            return;
        }
        $image = @imagecreatefromstring(file_get_contents($value->getRealPath()));
        if ($image === false) {
            $fail('This photo is incomplete or damaged. Please choose another image.');
        }
        unset($image);
    }
}
