<?php

use Elsewhere\Asset;
use Elsewhere\Page;
use Elsewhere\PageRenderer;
use Elsewhere\SitePage;

require __DIR__.'/private/autoload.php';

PageRenderer::render(page: new Page(
    file: SitePage::Destinations,
    title: 'Find your somewhere',
    description: 'Explore Italy, Japan, Bali, Tanzania, the Maldives and Greece. Find inspiration for a thoughtful, personal travel experience.',
    scripts: [Asset::App],
));
