<?php

namespace App\Data;

final readonly class AttachmentResponse
{
    /**
     * @param  string  $path
     * @param  string  $contentType
     * @param  bool  $inline
     * @param  array<string, string>  $headers
     */
    public function __construct(
        public string $path,
        public string $contentType,
        public bool $inline,
        public array $headers,
    ) {}
}
