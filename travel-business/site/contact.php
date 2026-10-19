<?php

use Elsewhere\Asset;
use Elsewhere\Page;
use Elsewhere\PageRenderer;
use Elsewhere\SitePage;

require __DIR__.'/private/autoload.php';

PageRenderer::render(page: new Page(
    file: SitePage::Contact,
    title: 'Let’s plan your journey',
    description: 'Tell us about your travel daydream. Explore the Elsewhere demo enquiry experience and start shaping a personal journey.',
    scripts: [Asset::Sandbox, Asset::App],
));
