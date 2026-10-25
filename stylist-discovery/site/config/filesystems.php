<?php

return [
    'default' => 'local',
    'disks' => [
        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/demo-runtime'),
            'serve' => false,
            'throw' => true,
            'report' => true,
        ],
    ],
    'links' => [],
];
