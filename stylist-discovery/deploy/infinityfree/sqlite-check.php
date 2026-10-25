<?php

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');
echo json_encode([
    'php' => PHP_VERSION,
    'pdo_sqlite' => extension_loaded('pdo_sqlite'),
    'gd' => extension_loaded('gd'),
    'argon2id' => in_array('argon2id', password_algos(), true),
    'memory_limit' => ini_get('memory_limit'),
    'upload_max_filesize' => ini_get('upload_max_filesize'),
    'post_max_size' => ini_get('post_max_size'),
    'max_file_uploads' => ini_get('max_file_uploads'),
    'max_execution_time' => ini_get('max_execution_time'),
], JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
