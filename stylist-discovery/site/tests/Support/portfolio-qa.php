<?php

use Tests\Support\PortfolioImages;

require __DIR__.'/PortfolioImages.php';

$destination = dirname(__DIR__, 3).'/docs/verification/fixtures/portfolio-qa.png';
if (! is_dir(dirname($destination))) {
    mkdir(dirname($destination), 0755, true);
}
if (file_exists($destination)) {
    throw new RuntimeException('QA fixture already exists.');
}
$bytes = PortfolioImages::bytes();
$handle = fopen($destination, 'xb');
try {
    if (fwrite($handle, $bytes) !== strlen($bytes)) {
        throw new RuntimeException('Incomplete QA fixture.');
    }
} finally {
    fclose($handle);
}
echo $destination." 480x600 original abstract QA fixture\n";
