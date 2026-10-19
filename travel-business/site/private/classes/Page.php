<?php

namespace Elsewhere;

final readonly class Page
{
    /**
     * @param SitePage $file
     * @param string $title
     * @param string $description
     * @param Asset[] $scripts
     */
    public function __construct(
        public SitePage $file,
        public string $title,
        public string $description,
        public array $scripts,
    ) {}
}
