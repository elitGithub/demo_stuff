<?php

define('ELSEWHERE_LOCAL_ORIGIN', getenv('ELSEWHERE_ORIGIN') ?: 'http://127.0.0.1:8089');
$site = dirname(__DIR__).'/site';
$prefix = '/travel-agency-demo/';
$refuse = function (int $status, string $message): bool {
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $message;

    return true;
};
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (!is_string($path)) {
    return $refuse(400, 'Bad request');
}
$path = preg_replace('#/{2,}#', '/', rawurldecode($path));
if ($path === '/' || $path === rtrim($prefix, '/')) {
    header('Location: '.$prefix, true, 302);

    return true;
}
if (!str_starts_with($path, $prefix) || str_contains($path, "\0") || str_contains($path, '\\')) {
    return $refuse(404, 'Not found');
}
$relative = substr($path, strlen($prefix));
$segments = explode('/', $relative);
if (strtolower($segments[0]) === 'private' || array_filter($segments, fn (string $segment): bool => str_starts_with($segment, '.')) !== []) {
    return $refuse(403, 'Forbidden');
}
if ($relative === '' || str_ends_with($relative, '/')) {
    $relative .= 'index.php';
}
$file = $site.'/'.$relative;
$extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
$type = match ($extension) {
    'css' => 'text/css; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8',
    'svg' => 'image/svg+xml',
    'jpg' => 'image/jpeg',
    'png' => 'image/png',
    'ttf' => 'font/ttf',
    'txt' => 'text/plain; charset=utf-8',
    default => null,
};
if (!is_file($file) || ($extension !== 'php' && $type === null)) {
    return $refuse(404, 'Not found');
}
if ($extension === 'php') {
    $_SERVER['SCRIPT_FILENAME'] = $file;
    $_SERVER['SCRIPT_NAME'] = $prefix.$relative;
    $_SERVER['PHP_SELF'] = $prefix.$relative;
    chdir(dirname($file));
    require $file;

    return true;
}
header('Content-Type: '.$type);
header('Content-Length: '.filesize($file));
readfile($file);

return true;
