<?php

use Elsewhere\Asset;
use Elsewhere\Page;
use Elsewhere\PageRenderer;
use Elsewhere\SitePage;

require __DIR__.'/private/autoload.php';

PageRenderer::render(page: new Page(
    file: SitePage::Journeys,
    title: 'Journeys made around you',
    description: 'Browse six thoughtfully crafted sample travel itineraries. Filter by destination and travel style, explore the details and make a journey your own.',
    scripts: [Asset::App],
));
