<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Throwable;

class RequestPhotoStorage
{
    public function store(UploadedFile $file): array
    {
        $mime = $file->getMimeType();
        $extension = match ($mime) {
            'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp',
            default => throw new RuntimeException('Unsupported photo format.'),
        };
        $dimensions = getimagesize($file->getRealPath());
        if (! $dimensions || $dimensions[0] > 4096 || $dimensions[1] > 4096) {
            throw new RuntimeException('Invalid photo dimensions.');
        }

        $filename = Str::uuid().'.'.$extension;
        $path = 'requests/'.$filename;
        try {
            if ($file->storeAs('requests', $filename, 'request-photos') === false) {
                throw new RuntimeException('The photo could not be saved.');
            }
        } catch (Throwable $exception) {
            // A failed adapter write can leave bytes before it throws. The caller
            // cannot clean this path because store() has not returned it yet.
            Storage::disk('request-photos')->delete($path);
            throw $exception;
        }

        return [
            'path' => $path, 'mime_type' => $mime,
            'original_name' => mb_substr(basename($file->getClientOriginalName()), 0, 255),
            'width' => $dimensions[0], 'height' => $dimensions[1],
        ];
    }

    public function delete(string $path): void
    {
        Storage::disk('request-photos')->delete($path);
    }
}
