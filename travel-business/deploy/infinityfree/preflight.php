<?php

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

/** @param int $status @param array $payload @return never */
$respond = static function (int $status, array $payload): never {
    http_response_code($status);
    echo json_encode($payload, JSON_THROW_ON_ERROR);
    exit;
};

$secretPath = __DIR__.'/private/preflight-secret.php';
$token = $_SERVER['HTTP_X_ELSEWHERE_PREFLIGHT'] ?? '';
try {
    $digest = is_file($secretPath) && !is_link($secretPath) ? require $secretPath : null;
} catch (Throwable $error) {
    $digest = null;
}
if (!is_string($digest) || !preg_match('/\A[a-f0-9]{64}\z/D', $digest) || !preg_match('/\A[a-f0-9]{64}\z/D', $token) || !hash_equals($digest, hash('sha256', $token))) {
    $respond(403, ['error' => 'Preflight authorization failed.']);
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    $respond(405, ['error' => 'POST required.']);
}
if (!preg_match('/\Aapplication\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*\z/iD', $_SERVER['CONTENT_TYPE'] ?? '')) {
    $respond(415, ['error' => 'JSON required.']);
}
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 1024) {
    $respond(413, ['error' => 'Request too large.']);
}
try {
    $raw = file_get_contents('php://input', false, null, 0, 1025);
    if ($raw === false || strlen($raw) > 1024) {
        $respond(413, ['error' => 'Request too large.']);
    }
    $input = json_decode($raw, false, 4, JSON_THROW_ON_ERROR);
} catch (JsonException $error) {
    $respond(400, ['error' => 'Invalid action.']);
}
if (!$input instanceof stdClass || array_keys(get_object_vars($input)) !== ['action'] || !is_string($input->action) || !in_array($input->action, ['check', 'hold', 'probe', 'finish'], true)) {
    $respond(400, ['error' => 'Invalid action.']);
}

$lock = null;
/** @param int $severity @param string $message @param string $file @param int $line @return never */
set_error_handler(static function (int $severity, string $message, string $file, int $line): never {
    throw new ErrorException($message, 0, $severity, $file, $line);
});
try {
    foreach ([__DIR__.'/private', __DIR__.'/private/runtime', __DIR__.'/private/runtime/preflight-v1'] as $directory) {
        if (is_link($directory) || (!is_dir($directory) && !mkdir($directory, 0700)) || !is_writable($directory)) {
            throw new RuntimeException('Fixture directory unavailable.');
        }
    }
    $fixture = __DIR__.'/private/runtime/preflight-v1';
    foreach (['fixture.lock', 'marker.tmp', 'marker.json'] as $name) {
        if (is_link($fixture.'/'.$name) || (file_exists($fixture.'/'.$name) && !is_file($fixture.'/'.$name))) {
            throw new RuntimeException('Invalid fixture.');
        }
    }
    $lock = fopen($fixture.'/fixture.lock', 'c+b');
    if ($lock === false) {
        throw new RuntimeException('Fixture lock unavailable.');
    }
    if (!flock($lock, LOCK_EX | LOCK_NB)) {
        fclose($lock);
        $respond($input->action === 'probe' ? 200 : 409, ['acquired' => false]);
    }
    $result = ['acquired' => true];
    if ($input->action === 'check') {
        $marker = json_encode(['marker' => bin2hex(random_bytes(16))], JSON_THROW_ON_ERROR);
        if (file_put_contents($fixture.'/marker.tmp', $marker, LOCK_EX) !== strlen($marker) || !rename($fixture.'/marker.tmp', $fixture.'/marker.json') || file_get_contents($fixture.'/marker.json') !== $marker) {
            throw new RuntimeException('Atomic fixture replacement failed.');
        }
        $result = ['acquired' => true, 'pdoSqlite' => extension_loaded('pdo_sqlite'), 'privateWritable' => true, 'atomicReplace' => true];
    } elseif ($input->action === 'hold') {
        usleep(3000000);
        $result['heldMilliseconds'] = 3000;
    } elseif ($input->action === 'finish') {
        foreach (['marker.tmp', 'marker.json'] as $name) {
            if (file_exists($fixture.'/'.$name) && !unlink($fixture.'/'.$name)) {
                throw new RuntimeException('Fixture cleanup failed.');
            }
        }
        $result['finished'] = true;
    }
    flock($lock, LOCK_UN);
    fclose($lock);
    $lock = null;
    $respond(200, $result);
} catch (Throwable $error) {
    if (is_resource($lock)) {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
    $respond(503, ['error' => 'Preflight fixture unavailable.']);
}
