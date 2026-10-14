<?php

declare(strict_types=1);
ini_set('display_errors', '0');
error_reporting(E_ALL);
header(
    "Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
);
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
header('Cache-Control: no-store');
$config = require __DIR__ . '/config.php';
require __DIR__ . '/Database.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/Store.php';
ini_set('session.use_strict_mode', '1');
ini_set('session.use_only_cookies', '1');
session_name('restrogirls_session');
$secure = $config['secure_cookies'] || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Lax']
);
if ($secure) {
    header('Strict-Transport-Security: max-age=31536000');
}
session_start();
if (isset($_SESSION['last_seen']) && time() - (int)$_SESSION['last_seen'] > 7200) {
    $_SESSION = [];
    session_regenerate_id(true);
}
$_SESSION['last_seen'] = time();
$_SESSION['_csrf'] ??= bin2hex(random_bytes(32));
$db = Database::connect($config);
$auth = new Auth($db);
$store = new Store($db, $config['delivery_fee_cents'], $config['timezone']);
$user = isset($_SESSION['user_id']) ? $auth->user((int)$_SESSION['user_id']) : null;
if (!$user) {
    unset($_SESSION['user_id']);
}

function e(mixed $value): string
{
    return htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function money(int $cents): string
{
    global $config;
    $prefix = match ($config['currency']) {
        'USD' => '$',
        'EUR' => '€',
        'GBP' => '£',
        'ILS' => '₪',
        'INR' => '₹',
        default => $config['currency'] . ' '
    };
    return $prefix . number_format($cents / 100, 2, '.', ',');
}

function displayTime(int $timestamp, string $format = 'M j, g:i a'): string
{
    global $config;
    return (new DateTimeImmutable('@' . $timestamp))->setTimezone(new DateTimeZone($config['timezone']))->format(
        $format
    );
}

function csrfField(): string
{
    return '<input type="hidden" name="_csrf" value="' . e($_SESSION['_csrf']) . '">';
}

function redirect(string $path): never
{
    header('Location: ' . $path, true, 303);
    exit;
}

function flash(string $message, string $type = 'success'): void
{
    $_SESSION['flash'] = ['message' => $message, 'type' => $type];
}

function cartCount(): int
{
    return array_sum($_SESSION['cart'] ?? []);
}

function render(string $template, array $data = []): void
{
    global $config, $user, $store;
    extract($data, EXTR_SKIP);
    $pageTitle = $data['title'] ?? 'Good food. Good mood.';
    $staff = $data['staff'] ?? false;
    $notice = $_SESSION['flash'] ?? null;
    unset($_SESSION['flash']);
    ob_start();
    require dirname(__DIR__) . '/templates/' . $template . '.php';
    $content = ob_get_clean();
    require dirname(__DIR__) . '/templates/layout.php';
}

function fail(int $status, string $message): never
{
    http_response_code($status);
    render('error', ['title' => 'Something needs your attention', 'message' => $message]);
    exit;
}

function requireLogin(): array
{
    global $user;
    if (!$user) {
        flash('Sign in to continue. Your cart is saved.', 'info');
        redirect('/login');
    }
    return $user;
}

function requireAdmin(): array
{
    $user = requireLogin();
    if ($user['role'] !== 'admin') {
        fail(403, 'This page is for restaurant staff.');
    }
    return $user;
}

function field(string $name, string $default = ''): string
{
    $value = $_POST[$name] ?? $default;
    if (!is_string($value)) {
        throw new InvalidArgumentException('Please check your form and try again.');
    }
    return $value;
}

function queryField(string $name, string $default = ''): string
{
    return isset($_GET[$name]) && is_string($_GET[$name]) ? $_GET[$name] : $default;
}

function positiveId(string $name): int
{
    $id = filter_var(field($name), FILTER_VALIDATE_INT);
    if (!$id || $id < 1) {
        throw new InvalidArgumentException('Choose a valid item.');
    }
    return $id;
}

function signIn(array $account): void
{
    session_regenerate_id(true);
    $_SESSION['user_id'] = $account['id'];
    $_SESSION['_csrf'] = bin2hex(random_bytes(32));
    unset($_SESSION['checkout_quotes']);
}
