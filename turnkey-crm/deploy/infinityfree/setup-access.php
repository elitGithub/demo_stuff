<?php

if (! is_file(__DIR__.'/storage/installed')) {
    header('Cache-Control: no-store');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex, nofollow');

    $tokenFile = __DIR__.'/setup-token.php';
    $expected = is_file($tokenFile) ? require $tokenFile : '';
    $query = $_GET['setup_key'] ?? '';
    $cookie = $_COOKIE['turnkey_setup'] ?? '';

    if (is_string($expected) && strlen($expected) === 64 && is_string($query) && hash_equals($expected, $query)) {
        setcookie('turnkey_setup', $expected, [
            'expires' => time() + 3600,
            'path' => '/',
            'secure' => true,
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        header('Location: /install', true, 303);
        exit;
    }

    if (! is_string($expected) || strlen($expected) !== 64 || ! is_string($cookie) || ! hash_equals($expected, $cookie)) {
        http_response_code(403);
        header('Content-Type: text/plain; charset=UTF-8');
        exit('Turnkey CRM is being prepared. Use the private setup link supplied with the deployment package.');
    }

    unset($expected, $query, $cookie, $tokenFile);
}
