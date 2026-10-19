<?php

namespace Elsewhere;

final readonly class Journey
{
    /**
     * @param string $id
     * @param string $title
     * @param Destination $destination
     * @param string $style
     * @param int $days
     * @param int $price
     * @param string $image
     * @param string $tag
     * @param string $route
     * @param string $intro
     * @param ItineraryDay[] $itinerary
     */
    public function __construct(
        public string $id,
        public string $title,
        public Destination $destination,
        public string $style,
        public int $days,
        public int $price,
        public string $image,
        public string $tag,
        public string $route,
        public string $intro,
        public array $itinerary,
    ) {}

    /** @return string */
    public function money(): string
    {
        return '$'.number_format($this->price);
    }
}
