<?php

namespace Elsewhere;

final readonly class SiteCatalog
{
    /**
     * @param Destination[] $destinations
     * @param Journey[] $journeys
     * @param Article[] $articles
     * @param string[] $budgets
     */
    public function __construct(
        public array $destinations,
        public array $journeys,
        public array $articles,
        public array $budgets,
    ) {}

    /** @return string[] */
    public function regions(): array
    {
        return array_values(array_unique(array_map(
            fn (Destination $destination): string => $destination->region,
            $this->destinations,
        )));
    }

    /** @return string[] */
    public function travelStyles(): array
    {
        return array_values(array_unique(array_map(
            fn (Journey $journey): string => $journey->style,
            $this->journeys,
        )));
    }
}
