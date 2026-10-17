<?php

use App\Providers\AppServiceProvider;
use App\Providers\ReadOnlyDatabaseServiceProvider;

return [
    ReadOnlyDatabaseServiceProvider::class,
    AppServiceProvider::class,
];
