<?php

namespace Elsewhere;

final class PageRenderer
{
    /**
     * @param Page $page
     * @return void
     * @throws \JsonException
     * @throws \UnexpectedValueException
     * @throws \RuntimeException
     */
    public static function render(Page $page): void
    {
        $private = dirname(__DIR__);
        $catalog = SiteCatalogLoader::load(
            catalogPath: $private.'/catalog.json',
            budgetsPath: $private.'/enquiry-budgets.json',
        );
        $idleHours = SandboxConfig::from(raw: new \stdClass())->idleSeconds / 3600;
        require $private.'/views/layout.php';
    }
}
