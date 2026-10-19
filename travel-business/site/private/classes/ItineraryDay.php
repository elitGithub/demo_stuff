<?php

namespace Elsewhere;

final readonly class ItineraryDay
{
    /**
     * @param string $day
     * @param string $title
     * @param string $description
     */
    public function __construct(
        public string $day,
        public string $title,
        public string $description,
    ) {}
}
