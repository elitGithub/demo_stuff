<?php
declare(strict_types=1);

// Environment variables take precedence. The optional local file is never public.
$envPath = dirname(__DIR__) . '/.env';
if (is_file($envPath)) {
    foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (preg_match('/^([A-Z][A-Z0-9_]*)=(.*)$/', trim($line), $match) && getenv($match[1]) === false) {
            $value = trim($match[2]);
            if (strlen($value) >= 2 && (($value[0] === '"' && str_ends_with($value, '"')) || ($value[0] === "'" && str_ends_with($value, "'")))) $value = substr($value, 1, -1);
            putenv($match[1] . '=' . $value);
        }
    }
}
$setting = static fn(string $name, string $default): string => getenv($name) === false ? $default : (string)getenv($name);
$timezone = $setting('APP_TIMEZONE', 'UTC');
new DateTimeZone($timezone);
$currency = $setting('APP_CURRENCY', 'USD');
if (!preg_match('/^[A-Z]{3}$/', $currency)) throw new RuntimeException('APP_CURRENCY must be a three-letter code.');
$fee = $setting('DELIVERY_FEE_CENTS', '350');
if (!ctype_digit($fee) || (int)$fee > 100000) throw new RuntimeException('Invalid delivery fee.');
return [
    'name' => $setting('APP_NAME', 'Resto-Chef'),
    'timezone' => $timezone,
    'currency' => $currency,
    'delivery_fee_cents' => (int)$fee,
    'secure_cookies' => $setting('SESSION_SECURE', '0') === '1',
    'db_driver' => $setting('DB_DRIVER', 'sqlite'),
    'db_path' => $setting('DB_PATH', dirname(__DIR__) . '/storage/demo.sqlite'),
    'db_host' => $setting('DB_HOST', '127.0.0.1'),
    'db_port' => $setting('DB_PORT', '3306'),
    'db_name' => $setting('DB_NAME', 'restaurant_demo'),
    'db_user' => $setting('DB_USER', ''),
    'db_password' => $setting('DB_PASSWORD', ''),
    'db_ssl_ca' => $setting('DB_SSL_CA', ''),
];
