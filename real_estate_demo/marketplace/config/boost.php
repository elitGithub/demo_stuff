<?php

return [
    'enabled' => env('BOOST_ENABLED', true),
    'browser_logs_watcher' => false,

    // Avoid spawning an additional Artisan command during guideline installation.
    'enforce_tests' => true,
];
