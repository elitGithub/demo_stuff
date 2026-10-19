<?php

namespace Elsewhere;

final readonly class Destination
{
    /**
     * @param string $id
     * @param string $name
     * @param string $region
     * @param string $image
     * @param string $imageAlt
     * @param string $line
     * @param string $description
     * @param string $places
     * @param string $season
     */
    public function __construct(
        public string $id,
        public string $name,
        public string $region,
        public string $image,
        public string $imageAlt,
        public string $line,
        public string $description,
        public string $places,
        public string $season,
    ) {}
}
