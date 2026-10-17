<?php

namespace App\Data;

final readonly class IncomingAttachment
{
    /**
     * @param  string  $filename
     * @param  string  $mimeType
     * @param  int  $sizeBytes
     * @param  string  $storagePath
     */
    public function __construct(
        public string $filename,
        public string $mimeType,
        public int $sizeBytes,
        public string $storagePath,
    ) {}
}
