<?php

header('Content-Type: text/plain; charset=UTF-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

echo 'PHP: '.PHP_VERSION.PHP_EOL;
echo 'pdo_sqlite: '.(extension_loaded('pdo_sqlite') ? 'yes' : 'no').PHP_EOL;
echo 'sqlite3: '.(extension_loaded('sqlite3') ? 'yes' : 'no').PHP_EOL;
echo 'SQLite library: '.(class_exists(SQLite3::class) ? SQLite3::version()['versionString'] : 'unavailable').PHP_EOL;
echo 'disable_functions: '.ini_get('disable_functions').PHP_EOL;
