<?php

namespace Elsewhere;

final readonly class Catalog implements \JsonSerializable
{
    /** @param CatalogDestination[] $destinations @param CatalogJourney[] $journeys @param string[] $budgets */
    public function __construct(public array $destinations, public array $journeys, public array $budgets)
    {
        foreach ($destinations as $destination) { if (!$destination instanceof CatalogDestination) { throw new \TypeError('Invalid destination collection.'); } }
        foreach ($journeys as $journey) { if (!$journey instanceof CatalogJourney) { throw new \TypeError('Invalid journey collection.'); } }
        foreach ($budgets as $budget) { if (!is_string($budget)) { throw new \TypeError('Invalid budget collection.'); } }
    }
    /** @return array<string, array> */
    public function jsonSerialize(): array { return ['destinations' => $this->destinations, 'journeys' => $this->journeys]; }
}
