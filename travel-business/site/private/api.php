<?php

ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/sandboxes/php-errors.log');

require __DIR__ . '/autoload.php';

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    if ((error_reporting() & $severity) !== 0) {
        throw new ErrorException($message, 0, $severity, $file, $line);
    }
    return false;
});

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

try {
    $configuration = require __DIR__ . '/config.php';
    if (!is_array($configuration) ||
        !isset($configuration['origin'], $configuration['base_path'], $configuration['sandbox_root']) ||
        $configuration['base_path'] !== '/travel-agency-demo') {
        throw new RuntimeException('Invalid private deployment configuration.');
    }
    $config = Elsewhere\SandboxConfig::from($configuration['sandbox']);
    $rawCatalog = json_decode(file_get_contents(__DIR__ . '/catalog.json'), flags: JSON_THROW_ON_ERROR);
    $catalog = new Elsewhere\Catalog(
        destinations: array_map(
                          fn(object $entry): Elsewhere\CatalogDestination => new Elsewhere\CatalogDestination(
                              id: $entry->id, name: $entry->name
                          ),
                          $rawCatalog->destinations
                      ),
        journeys    : array_map(
                          fn(object $entry): Elsewhere\CatalogJourney => new Elsewhere\CatalogJourney(
                              id         : $entry->id,
                              title      : $entry->title,
                              destination: $entry->destination,
                              price      : $entry->price
                          ),
                          $rawCatalog->journeys
                      ),
        budgets     : json_decode(file_get_contents(__DIR__ . '/enquiry-budgets.json'), flags: JSON_THROW_ON_ERROR),
    );
    $clock = fn(): int => time();
    $runtime = new Elsewhere\SandboxRuntime(
        root   : $configuration['sandbox_root'],
        config : $config,
        catalog: $catalog,
        now    : $clock
    );
    (new Elsewhere\ApiController(
        runtime: $runtime,
        catalog: $catalog,
        config : $config,
        origin : $configuration['origin'],
        now    : $clock
    ))->run();
} catch (Throwable $error) {
    error_log('API initialization failed: ' . $error);
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['error' => 'The demo storage is unavailable.', 'code' => 'unavailable'], JSON_THROW_ON_ERROR);
}
