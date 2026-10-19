<?php

set_error_handler(function (int $severity, string $message, string $file, int $line): bool {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

try {
    $root = dirname(__DIR__);
    $site = realpath($root.'/site');
    if ($site === false || !is_dir($site)) {
        throw new RuntimeException('The site folder is missing: '.$root.'/site');
    }
    if ($argc === 1) {
        $requested = $root.'/deploy/builds/'.date('Ymd-His');
    } elseif ($argc === 3 && $argv[1] === '--output' && $argv[2] !== '') {
        $requested = $argv[2];
    } else {
        throw new InvalidArgumentException('Usage: php bin/package.php [--output <new or empty folder>]');
    }
    $segments = [];
    foreach (explode('/', str_starts_with($requested, '/') ? $requested : getcwd().'/'.$requested) as $segment) {
        if ($segment === '..') {
            array_pop($segments);
        } elseif ($segment !== '' && $segment !== '.') {
            $segments[] = $segment;
        }
    }
    $normalised = '/'.implode('/', $segments);
    $ancestor = $normalised;
    while (!file_exists($ancestor)) {
        $ancestor = dirname($ancestor);
    }
    $output = rtrim(realpath($ancestor).substr($normalised, strlen($ancestor)), '/') ?: '/';
    if ($output === $site || str_starts_with($output, $site.'/')) {
        throw new RuntimeException('The output folder must be outside the site folder: '.$output);
    }
    if (file_exists($output) && (!is_dir($output) || count(scandir($output)) !== 2)) {
        throw new RuntimeException('The output folder must be new or empty: '.$output);
    }
    $entries = [];
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($site, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $file) {
        $relative = substr($file->getPathname(), strlen($site) + 1);
        if ($file->isLink() || !$file->isFile()) {
            throw new RuntimeException('Only regular files can be packaged: '.$relative);
        }
        $excluded = fnmatch('*.sqlite*', $file->getFilename(), FNM_CASEFOLD)
            || fnmatch('*.log', $file->getFilename(), FNM_CASEFOLD)
            || (str_starts_with($relative, 'private/sandboxes/') && $relative !== 'private/sandboxes/.htaccess');
        if ($excluded) {
            continue;
        }
        $allowed = $file->getFilename() === '.htaccess' || (!str_starts_with($file->getFilename(), '.') && match ($file->getExtension()) {
            'php', 'css', 'js', 'json', 'sql', 'svg', 'jpg', 'png', 'ttf', 'txt' => true,
            default => false,
        });
        if (!$allowed) {
            throw new RuntimeException('Refusing to package a file outside the allowlist: '.$relative);
        }
        $entries[$relative] = $file->getPathname();
    }
    ksort($entries, SORT_STRING);
    if (!file_exists($output)) {
        mkdir($output, 0755, true);
    }
    $archivePath = $output.'/travel-demo.zip';
    $archive = new ZipArchive();
    $opened = $archive->open($archivePath, ZipArchive::CREATE | ZipArchive::EXCL);
    if ($opened !== true) {
        throw new RuntimeException('The archive could not be created: '.$archivePath.' (code '.$opened.')');
    }
    foreach ($entries as $relative => $absolute) {
        if (!$archive->addFile($absolute, 'travel-agency-demo/'.$relative)) {
            throw new RuntimeException('The archive entry could not be added: '.$relative);
        }
    }
    if (!$archive->close()) {
        throw new RuntimeException('The archive could not be written: '.$archivePath);
    }
    echo 'path: '.$archivePath.PHP_EOL;
    echo 'bytes: '.filesize($archivePath).PHP_EOL;
    echo 'files: '.count($entries).PHP_EOL;
    echo 'sha256: '.hash_file('sha256', $archivePath).PHP_EOL;
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage().PHP_EOL);
    exit(1);
}
