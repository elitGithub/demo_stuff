<?php

namespace Elsewhere;

final readonly class Article
{
    /**
     * @param string $id
     * @param string $title
     * @param string $category
     * @param string $image
     * @param string $imageAlt
     * @param string $time
     * @param string $excerpt
     * @param string[] $paragraphs
     */
    public function __construct(
        public string $id,
        public string $title,
        public string $category,
        public string $image,
        public string $imageAlt,
        public string $time,
        public string $excerpt,
        public array $paragraphs,
    ) {}
}
