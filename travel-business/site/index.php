<?php

use Elsewhere\Asset;
use Elsewhere\Page;
use Elsewhere\PageRenderer;
use Elsewhere\SitePage;

require __DIR__.'/private/autoload.php';

PageRenderer::render(page: new Page(
    file: SitePage::Home,
    title: 'Thoughtfully personal travel',
    description: 'Discover extraordinary places and thoughtful journeys with Elsewhere. Explore your next destination and imagine a journey made around you.',
    scripts: [Asset::App],
));
