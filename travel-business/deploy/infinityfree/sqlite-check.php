<?php

header('Content-Type: text/plain');
echo 'PHP ' . PHP_VERSION . "\n";
echo 'pdo_sqlite: ' . (extension_loaded('pdo_sqlite') ? 'yes' : 'no') . "\n";
