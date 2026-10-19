<?php

namespace Elsewhere;

final class SiteCatalogLoader
{
    /**
     * @param string $catalogPath
     * @param string $budgetsPath
     * @return SiteCatalog
     * @throws \JsonException
     * @throws \UnexpectedValueException
     */
    public static function load(string $catalogPath, string $budgetsPath): SiteCatalog
    {
        $raw = json_decode(file_get_contents($catalogPath), flags: JSON_THROW_ON_ERROR);
        $destinations = [];
        foreach ($raw->destinations as $entry) {
            if (isset($destinations[$entry->id])) {
                throw new \UnexpectedValueException('Duplicate catalog destination '.$entry->id.'.');
            }
            $destinations[$entry->id] = new Destination(
                id: $entry->id,
                name: $entry->name,
                region: $entry->region,
                image: $entry->image,
                imageAlt: $entry->imageAlt,
                line: $entry->line,
                description: $entry->description,
                places: $entry->places,
                season: $entry->season,
            );
        }
        $journeys = [];
        foreach ($raw->journeys as $entry) {
            if (!isset($destinations[$entry->destination])) {
                throw new \UnexpectedValueException('Catalog journey '.$entry->id.' names an unknown destination.');
            }
            $journeys[] = new Journey(
                id: $entry->id,
                title: $entry->title,
                destination: $destinations[$entry->destination],
                style: $entry->style,
                days: $entry->days,
                price: $entry->price,
                image: $entry->image,
                tag: $entry->tag,
                route: $entry->route,
                intro: $entry->intro,
                itinerary: array_map(
                    fn (object $stop): ItineraryDay => new ItineraryDay(
                        day: $stop->day,
                        title: $stop->title,
                        description: $stop->description,
                    ),
                    $entry->itinerary,
                ),
            );
        }
        $articles = array_map(
            fn (object $entry): Article => new Article(
                id: $entry->id,
                title: $entry->title,
                category: $entry->category,
                image: $entry->image,
                imageAlt: $entry->imageAlt,
                time: $entry->time,
                excerpt: $entry->excerpt,
                paragraphs: $entry->paragraphs,
            ),
            $raw->articles,
        );

        return new SiteCatalog(
            destinations: array_values($destinations),
            journeys: $journeys,
            articles: $articles,
            budgets: json_decode(file_get_contents($budgetsPath), flags: JSON_THROW_ON_ERROR),
        );
    }
}
