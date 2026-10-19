<?php

use Elsewhere\Asset;
use Elsewhere\Page;
use Elsewhere\PageRenderer;
use Elsewhere\SitePage;

require __DIR__.'/private/autoload.php';

PageRenderer::render(page: new Page(
    file: SitePage::Journal,
    title: 'Notes from Elsewhere',
    description: 'Travel stories, destination inspiration and thoughtful perspectives for the curious traveller. Step inside the Elsewhere journal.',
    scripts: [Asset::App],
));
