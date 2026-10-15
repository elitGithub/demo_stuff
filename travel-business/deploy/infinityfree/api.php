<?php
declare(strict_types=1);

// Executed only by the public api.php entry point.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

final class DemoInputError extends RuntimeException {}
function fail(string $message, int $status = 400): never { throw new DemoInputError($message, $status); }
function respond(array $data, int $status = 200): never {
    http_response_code($status);
    echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}
function payload(): object {
    if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) fail('Please send JSON data.', 415);
    if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 16384) fail('That submission is too large.', 413);
    $raw = file_get_contents('php://input', false, null, 0, 16385);
    if ($raw === false || strlen($raw) > 16384) fail('That submission is too large.', 413);
    try { $data = json_decode($raw, false, 32, JSON_THROW_ON_ERROR); }
    catch (JsonException) { fail('The submitted data is not valid JSON.'); }
    if (!is_object($data)) fail('Please provide your enquiry details.');
    return $data;
}
function field(object $input, string $key, int $max, bool $required = false): string {
    $raw = $input->$key ?? '';
    if (!is_string($raw)) fail("Please check the {$key} field.");
    $value = trim($raw);
    if (($required && $value === '') || mb_strlen($value, 'UTF-8') > $max || preg_match('/[\x00-\x08\x0b\x0c\x0e-\x1f]/', $value)) fail("Please check the {$key} field.");
    return $value;
}
function validate(object $input, array $catalog): array {
    $data = [];
    foreach (['firstName' => 60, 'lastName' => 60, 'email' => 160, 'destination' => 40, 'journey' => 60, 'departure' => 10, 'budget' => 40, 'message' => 2000] as $key => $max) {
        $data[$key] = field($input, $key, $max, in_array($key, ['firstName', 'lastName', 'email'], true));
    }
    if (!preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/u', $data['email'])) fail('Please enter a valid email address.');
    if ($data['destination'] !== '' && !in_array($data['destination'], array_column($catalog['destinations'], 'id'), true)) fail('Please choose a destination from the list.');
    $selected = null;
    foreach ($catalog['journeys'] as $journey) if ($journey['id'] === $data['journey']) $selected = $journey;
    if ($data['journey'] !== '' && !$selected) fail('Please choose a journey from the list.');
    if ($selected && $data['destination'] !== '' && $selected['destination'] !== $data['destination']) fail('Please choose a journey that matches your destination, or select a personal journey.');
    if ($selected && $data['destination'] === '') $data['destination'] = $selected['destination'];
    if ($data['departure'] !== '') {
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $data['departure'], new DateTimeZone('UTC'));
        if (!$date || $date->format('Y-m-d') !== $data['departure']) fail('Please choose a valid departure date.');
        if ($data['departure'] < gmdate('Y-m-d', time() - 86400)) fail('Please choose a future departure date, or leave it flexible.');
    }
    if (!isset($input->travelers) || !is_int($input->travelers) || $input->travelers < 1 || $input->travelers > 12) fail('Please choose between 1 and 12 travellers.');
    $data['travelers'] = $input->travelers;
    if (!in_array($data['budget'], ['', '$2,000–$3,500', '$3,500–$5,000', '$5,000–$8,000', '$8,000+'], true)) fail('Please choose a budget from the list.');
    if (($input->consent ?? false) !== true) fail('Please acknowledge that this is a demo using fictional details.');
    return $data;
}
function sql(PDO $db, string $query, array $params = []): PDOStatement {
    $statement = $db->prepare($query);
    $statement->execute($params);
    return $statement;
}
function transaction(PDO $db, callable $action): mixed {
    $db->exec('BEGIN IMMEDIATE');
    try { $result = $action(); $db->exec('COMMIT'); return $result; }
    catch (Throwable $error) { $db->exec('ROLLBACK'); throw $error; }
}
function openDatabase(): PDO {
    $directory = __DIR__.'/runtime';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Cannot create private storage.');
    $db = new PDO('sqlite:'.$directory.'/demo.sqlite', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $db->exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    $db->exec(file_get_contents(__DIR__.'/schema.sql'));
    transaction($db, function () use ($db): void {
        if (sql($db, "SELECT value FROM metadata WHERE key='seeded'")->fetchColumn()) return;
        $seed = json_decode(file_get_contents(__DIR__.'/seed.json'), true, 32, JSON_THROW_ON_ERROR);
        foreach ($seed['enquiries'] as $row) {
            sql($db, 'INSERT INTO enquiries (id,reference,firstName,lastName,email,destination,journey,departure,travelers,budget,message,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', array_map(fn($key) => $row[$key], ['id','reference','firstName','lastName','email','destination','journey','departure','travelers','budget','message','status','createdAt']));
        }
        foreach ($seed['bookings'] as $row) {
            sql($db, 'INSERT INTO bookings (id,reference,enquiryId,firstName,lastName,destination,journey,departure,travelers,value,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', array_map(fn($key) => $row[$key], ['id','reference','enquiryId','firstName','lastName','destination','journey','departure','travelers','value','status','createdAt']));
        }
        sql($db, "INSERT INTO metadata (key,value) VALUES ('seeded','1')");
    });
    return $db;
}
function limitRequests(PDO $db, string $kind): void {
    $key = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? 'unknown').'|'.$kind);
    transaction($db, function () use ($db, $key): void {
        sql($db, 'DELETE FROM rate_limits WHERE expires < ?', [time()]);
        $count = (int) sql($db, 'SELECT hits FROM rate_limits WHERE key=?', [$key])->fetchColumn();
        if ($count >= 50) fail('The demo has received too many requests. Please try again later.', 429);
        sql($db, 'INSERT INTO rate_limits (key,hits,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1', [$key, time() + 3600]);
    });
}
function startDemoSession(array $config): void {
    $directory = __DIR__.'/runtime/sessions';
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Cannot create private session storage.');
    session_save_path($directory);
    session_name('elsewhere_travel_demo');
    ini_set('session.use_strict_mode', '1');
    session_set_cookie_params(['lifetime' => 14400, 'path' => $config['base_path'].'/', 'secure' => str_starts_with($config['origin'], 'https:'), 'httponly' => true, 'samesite' => 'Strict']);
    if (!session_start()) throw new RuntimeException('Cannot start demo session.');
}

try {
    $config = require __DIR__.'/config.php';
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '' && $origin !== $config['origin']) fail('Cross-origin requests are not allowed.', 403);
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') fail('Cross-site requests are not allowed.', 403);
    $route = $_GET['route'] ?? '';
    if (!is_string($route)) fail('Invalid API route.');
    $method = $_SERVER['REQUEST_METHOD'];
    $catalog = json_decode(file_get_contents(__DIR__.'/catalog.json'), true, 32, JSON_THROW_ON_ERROR);
    $db = openDatabase();
    if ($route === 'enquiries' && $method === 'POST') {
        limitRequests($db, 'enquiries');
        $data = validate(payload(), $catalog);
        $reference = 'EW-'.strtoupper(bin2hex(random_bytes(4)));
        sql($db, 'INSERT INTO enquiries (reference,firstName,lastName,email,destination,journey,departure,travelers,budget,message,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [$reference,$data['firstName'],$data['lastName'],$data['email'],$data['destination'],$data['journey'],$data['departure'],$data['travelers'],$data['budget'],$data['message'],'new',gmdate('c')]);
        respond(['id' => (int) $db->lastInsertId(), 'reference' => $reference], 201);
    }
    if (str_starts_with($route, 'admin/')) {
        startDemoSession($config);
        if ($route === 'admin/login' && $method === 'POST') {
            limitRequests($db, 'login'); payload(); session_regenerate_id(true);
            $_SESSION['demo_expires'] = time() + 14400;
            respond(['ok' => true]);
        }
        if (($_SESSION['demo_expires'] ?? 0) < time()) fail('Enter the demo dashboard to continue.', 401);
        if ($route === 'admin/logout' && $method === 'POST') {
            payload(); $_SESSION = []; session_destroy();
            setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $config['base_path'].'/', 'secure' => str_starts_with($config['origin'], 'https:'), 'httponly' => true, 'samesite' => 'Strict']);
            respond(['ok' => true]);
        }
        if ($route === 'admin/overview' && $method === 'GET') {
            respond(['enquiries' => sql($db, 'SELECT * FROM enquiries ORDER BY id DESC')->fetchAll(), 'bookings' => sql($db, 'SELECT * FROM bookings ORDER BY id DESC')->fetchAll(), 'catalog' => $catalog]);
        }
        if (preg_match('~^admin/enquiries/([1-9][0-9]*)(/booking)?$~', $route, $matches)) {
            $id = filter_var($matches[1], FILTER_VALIDATE_INT);
            if ($id === false) fail('Invalid enquiry ID.');
            if (empty($matches[2]) && $method === 'PATCH') {
                $status = payload()->status ?? '';
                if (!in_array($status, ['new','contacted','proposal','closed'], true)) fail('Please choose a valid enquiry status.');
                transaction($db, function () use ($db, $id, $status): void {
                    $record = sql($db, 'SELECT status FROM enquiries WHERE id=?', [$id])->fetch();
                    if (!$record) fail('Enquiry not found.', 404);
                    if ($record['status'] === 'converted') fail('This enquiry already has a demo booking record.', 409);
                    sql($db, 'UPDATE enquiries SET status=? WHERE id=?', [$status,$id]);
                });
                respond(['ok' => true]);
            }
            if (!empty($matches[2]) && $method === 'POST') {
                payload();
                $reference = transaction($db, function () use ($db, $id, $catalog): string {
                    $record = sql($db, 'SELECT * FROM enquiries WHERE id=?', [$id])->fetch();
                    if (!$record) fail('Enquiry not found.', 404);
                    if (sql($db, 'SELECT id FROM bookings WHERE enquiryId=?', [$id])->fetch()) fail('A demo booking already exists for this enquiry.', 409);
                    $price = 0;
                    foreach ($catalog['journeys'] as $journey) if ($journey['id'] === $record['journey']) $price = $journey['price'];
                    $reference = 'BK-'.strtoupper(bin2hex(random_bytes(4)));
                    sql($db, 'INSERT INTO bookings (reference,enquiryId,firstName,lastName,destination,journey,departure,travelers,value,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [$reference,$id,$record['firstName'],$record['lastName'],$record['destination'],$record['journey'],$record['departure'],$record['travelers'],$price*$record['travelers'],'planning',gmdate('c')]);
                    sql($db, "UPDATE enquiries SET status='converted' WHERE id=?", [$id]);
                    return $reference;
                });
                respond(['reference' => $reference], 201);
            }
        }
    }
    fail('API route not found.', 404);
} catch (DemoInputError $error) {
    respond(['error' => $error->getMessage()], $error->getCode());
} catch (Throwable $error) {
    error_log('Elsewhere demo: '.$error->getMessage());
    respond(['error' => 'The demo could not complete that request. Please try again.'], 500);
}
