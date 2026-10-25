<?php

namespace App\Services;

use App\Data\PortfolioInput;
use App\Data\SandboxContext;
use App\Enums\SandboxStatus;
use App\Enums\UploadStatus;
use App\Models\PortfolioImage;
use App\Models\Registry\Sandbox;
use App\Models\Registry\SandboxFile;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class PortfolioService
{
    /**
     * @param  User  $actor
     * @param  SandboxContext  $context
     * @param  PortfolioInput  $input
     * @return PortfolioImage
     */
    public function store(User $actor, SandboxContext $context, PortfolioInput $input): PortfolioImage
    {
        $this->assertAccess($context);
        Gate::forUser($actor)->authorize('create', PortfolioImage::class);
        $profile = app(StylistService::class)->profile($actor);
        $bytes = $this->encode($input->image);
        $extension = str_starts_with($bytes, "\x89PNG") ? '.png' : '.jpg';
        $key = bin2hex(random_bytes(32)).$extension;
        $file = SandboxFile::query()->create(['sandbox_digest' => $context->digest, 'storage_key' => $key, 'status' => UploadStatus::Reserved, 'created_at' => CarbonImmutable::now()]);
        $path = app(SandboxService::class)->path($key);
        $handle = fopen($path, 'xb');
        if ($handle === false) {
            throw new RuntimeException('Cannot create private image.');
        }
        try {
            if (! chmod($path, 0600) || fwrite($handle, $bytes) !== strlen($bytes) || ! fflush($handle)) {
                throw new RuntimeException('Cannot persist private image.');
            }
        } finally {
            fclose($handle);
        }
        $image = PortfolioImage::query()->create(['profile_id' => $profile->id, 'storage_key' => $key, 'caption' => $input->caption, 'position' => ((int) $profile->portfolioImages()->max('position')) + 1]);
        DB::connection('visitor')->afterCommit(function () use ($file): void {
            try {
                SandboxFile::query()->whereKey($file->id)->where('status', UploadStatus::Reserved)->update(['status' => UploadStatus::Attached]);
            } catch (Throwable $exception) {
                Log::error('Private image finalization deferred.', ['exception' => $exception]);
            }
        });

        return $image;
    }

    /**
     * @param  User  $actor
     * @param  SandboxContext  $context
     * @param  PortfolioImage  $image
     * @return void
     */
    public function remove(User $actor, SandboxContext $context, PortfolioImage $image): void
    {
        $this->assertAccess($context);
        abort_unless(Gate::forUser($actor)->allows('delete', $image), 404);
        $file = SandboxFile::query()->where('sandbox_digest', $context->digest)->where('storage_key', $image->storage_key)->firstOrFail();
        $file->update(['status' => UploadStatus::Retiring]);
        $image->delete();
    }

    /**
     * @param  User  $actor
     * @param  SandboxContext  $context
     * @param  PortfolioImage  $image
     * @return Response
     */
    public function read(User $actor, SandboxContext $context, PortfolioImage $image): Response
    {
        $this->assertAccess($context);
        $current = PortfolioImage::query()->with('profile')->whereKey($image->id)->where('storage_key', $image->storage_key)->firstOrFail();
        abort_unless(Gate::forUser($actor)->allows('view', $current), 404);
        abort_unless($current->seed_asset === null && SandboxFile::query()->where('sandbox_digest', $context->digest)->where('storage_key', $current->storage_key)->exists(), 404);
        $path = app(SandboxService::class)->path($current->storage_key);
        $bytes = file_get_contents($path, length: config('demo.limits.image_bytes') + 1);
        if ($bytes === false || strlen($bytes) > config('demo.limits.image_bytes')) {
            throw new RuntimeException('Private image is unavailable.');
        }

        return new Response($bytes, 200, ['Content-Type' => str_ends_with($current->storage_key, '.png') ? 'image/png' : 'image/jpeg', 'X-Content-Type-Options' => 'nosniff', 'Cache-Control' => 'private, no-store']);
    }

    /**
     * @param  SandboxContext  $context
     * @return void
     */
    public function assertAccess(SandboxContext $context): void
    {
        $connection = DB::connection('visitor');
        if ($connection->transactionLevel() < 1) {
            throw new RuntimeException('Private images require admitted visitor access.');
        }
        $connection->table('sandbox_meta')->where('id', 1)->increment('access_lock_version');
        abort_unless($connection->table('sandbox_meta')->where('id', 1)->value('generation') === $context->generation && Sandbox::query()->whereKey($context->digest)->where('generation', $context->generation)->where('status', SandboxStatus::Active)->exists(), 410);
    }

    /**
     * @param  UploadedFile  $upload
     * @return string
     *
     * @throws ValidationException
     */
    public function encode(UploadedFile $upload): string
    {
        if (! $upload->isValid() || $upload->getSize() > config('demo.limits.upload_bytes')) {
            throw ValidationException::withMessages(['image' => 'Choose an image smaller than 5 MB.']);
        }
        $bytes = file_get_contents($upload->getPathname(), length: config('demo.limits.upload_bytes') + 1);
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        $dimensions = @getimagesizefromstring($bytes);
        if ($dimensions === false || ! in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true) || $dimensions['mime'] !== $mime) {
            throw ValidationException::withMessages(['image' => 'Choose a JPG, PNG or WebP image.']);
        }
        if ($dimensions[0] < 1 || $dimensions[1] < 1 || max($dimensions[0], $dimensions[1]) > config('demo.limits.upload_edge')) {
            throw ValidationException::withMessages(['image' => 'This image is too large. Choose one no wider or taller than 4096 pixels.']);
        }
        if (config('demo.limits.upload_pixels') < $dimensions[0] * $dimensions[1]) {
            throw ValidationException::withMessages(['image' => 'Choose a smaller image, up to 4 megapixels.']);
        }
        $this->inspectContainer($bytes, $mime);
        $source = @imagecreatefromstring($bytes);
        if ($source === false) {
            throw ValidationException::withMessages(['image' => 'This image cannot be read. Choose another image.']);
        }
        $scale = min(1, config('demo.limits.image_edge') / max($dimensions[0], $dimensions[1]));
        $target = imagecreatetruecolor(max(1, (int) round($dimensions[0] * $scale)), max(1, (int) round($dimensions[1] * $scale)));
        try {
            imagealphablending($target, false);
            imagesavealpha($target, true);
            imagecopyresampled($target, $source, 0, 0, 0, 0, imagesx($target), imagesy($target), imagesx($source), imagesy($source));
            ob_start();
            try {
                $written = $mime === 'image/jpeg' ? imagejpeg($target, null, 85) : imagepng($target, null, 9);
                $output = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            if (! $written || ! is_string($output) || strlen($output) > config('demo.limits.image_bytes')) {
                throw ValidationException::withMessages(['image' => 'This image is too detailed to save. Choose a smaller or simpler image.']);
            }

            return $output;
        } finally {
            imagedestroy($source);
            imagedestroy($target);
        }
    }

    /**
     * @param  string  $bytes
     * @param  string  $mime
     * @return void
     *
     * @throws ValidationException
     */
    public function inspectContainer(string $bytes, string $mime): void
    {
        $valid = true;
        $length = strlen($bytes);
        if ($mime === 'image/png') {
            $valid = str_starts_with($bytes, "\x89PNG\r\n\x1a\n");
            $offset = 8;
            $ended = false;
            $hasData = false;
            while ($valid && $offset < $length) {
                if ($length - $offset < 12) {
                    $valid = false;
                    break;
                }
                $chunkLength = unpack('Nlength', substr($bytes, $offset, 4))['length'];
                $type = substr($bytes, $offset + 4, 4);
                if (in_array($type, ['acTL', 'fcTL', 'fdAT'], true)) {
                    throw ValidationException::withMessages(['image' => 'Animated images are not supported. Choose a still image.']);
                }
                if ($chunkLength > $length - $offset - 12 || preg_match('/\A[A-Za-z]{4}\z/', $type) !== 1 || ($offset === 8 && ($type !== 'IHDR' || $chunkLength !== 13)) || ($offset !== 8 && $type === 'IHDR')) {
                    $valid = false;
                    break;
                }
                $body = substr($bytes, $offset + 4, $chunkLength + 4);
                if (hash('crc32b', $body, true) !== substr($bytes, $offset + 8 + $chunkLength, 4)) {
                    $valid = false;
                    break;
                }
                $offset += $chunkLength + 12;
                $hasData = $hasData || $type === 'IDAT';
                if ($type === 'IEND') {
                    $ended = $chunkLength === 0 && $offset === $length;
                    break;
                }
            }
            $valid = $valid && $ended && $hasData;
        } elseif ($mime === 'image/webp') {
            $valid = $length >= 20 && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP' && unpack('Vlength', substr($bytes, 4, 4))['length'] === $length - 8;
            $offset = 12;
            $hasData = false;
            while ($valid && $offset < $length) {
                if ($length - $offset < 8) {
                    $valid = false;
                    break;
                }
                $type = substr($bytes, $offset, 4);
                $chunkLength = unpack('Vlength', substr($bytes, $offset + 4, 4))['length'];
                if (in_array($type, ['ANIM', 'ANMF'], true) || ($type === 'VP8X' && $chunkLength >= 1 && $chunkLength <= $length - $offset - 8 && (ord($bytes[$offset + 8]) & 2) !== 0)) {
                    throw ValidationException::withMessages(['image' => 'Animated images are not supported. Choose a still image.']);
                }
                if ($chunkLength > $length - $offset - 8 || ($type === 'VP8X' && $chunkLength !== 10)) {
                    $valid = false;
                    break;
                }
                $hasData = $hasData || in_array($type, ['VP8 ', 'VP8L'], true);
                $offset += 8 + $chunkLength + ($chunkLength % 2);
            }
            $valid = $valid && $offset === $length && $hasData;
        } else {
            $valid = str_starts_with($bytes, "\xff\xd8") && str_ends_with($bytes, "\xff\xd9");
            $offset = 2;
            $hasScan = false;
            while ($valid && $offset < $length - 2) {
                if (ord($bytes[$offset]) !== 255) {
                    $valid = false;
                    break;
                }
                while ($offset < $length && ord($bytes[$offset]) === 255) {
                    $offset++;
                }
                if ($offset >= $length) {
                    $valid = false;
                    break;
                }
                $marker = ord($bytes[$offset++]);
                if ($marker === 0 || $marker === 216 || $marker === 217 || $length - $offset < 2) {
                    $valid = false;
                    break;
                }
                $segmentLength = unpack('nlength', substr($bytes, $offset, 2))['length'];
                if ($segmentLength < 2 || $segmentLength > $length - $offset) {
                    $valid = false;
                    break;
                }
                $offset += $segmentLength;
                if ($marker === 218) {
                    $hasScan = true;
                    while ($offset < $length - 2) {
                        if (ord($bytes[$offset]) !== 255) {
                            $offset++;

                            continue;
                        }
                        $next = ord($bytes[$offset + 1]);
                        if ($next === 0 || ($next >= 208 && $next <= 215)) {
                            $offset += 2;

                            continue;
                        }
                        break;
                    }
                }
            }
            $valid = $valid && $hasScan && $offset === $length - 2;
        }
        if (! $valid) {
            throw ValidationException::withMessages(['image' => 'This file appears incomplete or damaged. Choose another image.']);
        }
    }
}
