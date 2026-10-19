<?php

use Elsewhere\Asset;
use Elsewhere\Page;
use Elsewhere\PageRenderer;
use Elsewhere\SitePage;

require __DIR__.'/private/autoload.php';

PageRenderer::render(page: new Page(
    file: SitePage::About,
    title: 'The Elsewhere story',
    description: 'Discover the idea behind Elsewhere: thoughtful, unhurried travel shaped around your curiosity, with local perspectives and human connection.',
    scripts: [Asset::App],
));
