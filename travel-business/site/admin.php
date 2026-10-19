<?php

use Elsewhere\Asset;
use Elsewhere\Page;
use Elsewhere\PageRenderer;
use Elsewhere\SitePage;

require __DIR__.'/private/autoload.php';

PageRenderer::render(page: new Page(
    file: SitePage::Admin,
    title: 'Demo travel workspace',
    description: 'Explore saved demo enquiries and fictional bookings in the Elsewhere demonstration dashboard.',
    scripts: [Asset::Sandbox, Asset::DashboardPagination, Asset::App, Asset::Admin],
));
