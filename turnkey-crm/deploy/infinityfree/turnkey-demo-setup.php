<?php

use Illuminate\Contracts\Http\Kernel;
use Illuminate\Foundation\Bootstrap\LoadConfiguration;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use Webkul\Activity\Repositories\ActivityRepository;
use Webkul\Contact\Repositories\OrganizationRepository;
use Webkul\Contact\Repositories\PersonRepository;
use Webkul\Core\Repositories\CoreConfigRepository;
use Webkul\Lead\Repositories\LeadRepository;
use Webkul\Product\Repositories\ProductRepository;
use Webkul\Quote\Repositories\QuoteRepository;
use Webkul\Turnkey\Database\Seeders\DemoSeeder;
use Webkul\Turnkey\Support\HostedDemoSetup;
use Webkul\User\Repositories\UserRepository;

header('Cache-Control: no-store, private');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
ini_set('display_errors', '0');

function demoPage(string $title, string $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=UTF-8');
    echo '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>Turnkey CRM · Demo setup</title><style>body{margin:0;background:#f1f5f9;color:#1e293b;font:16px/1.6 system-ui,sans-serif}main{max-width:660px;margin:64px auto;padding:36px;background:white;border:1px solid #dbe3ee;border-radius:16px}h1{font-size:28px;line-height:1.2}small{color:#2563eb;font-weight:700;letter-spacing:.08em}button,a.button{display:inline-block;background:#2563eb;color:white;border:0;border-radius:8px;padding:12px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}code{overflow-wrap:anywhere}a{color:#1d4ed8}.note{color:#64748b}@media(max-width:720px){main{margin:20px;padding:24px}}</style>';
    echo '<main><small>TURNKEY CRM</small><h1>'.htmlspecialchars($title, ENT_QUOTES, 'UTF-8').'</h1>'.$body.'</main></html>';
    exit;
}

function demoEscape(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
}

$private = __DIR__.'/_app';
$complete = $private.'/storage/turnkey-demo-live';
$preparing = $private.'/storage/turnkey-demo-preparing';
if (is_file($complete)) {
    demoPage('Demo setup is complete', '<p>This setup page is disabled. Delete <code>turnkey-demo-setup.php</code> from htdocs.</p><a class="button" href="/admin/login">Open the CRM</a>', 410);
}

$helper = $private.'/packages/Webkul/Turnkey/src/Support/HostedDemoSetup.php';
if (! is_file($helper)) {
    demoPage('Upload incomplete', '<p>Upload all five files from the demo setup package, preserving their folders.</p>', 503);
}
require_once $helper;

$tokenFile = $private.'/setup-token.php';
$token = is_file($tokenFile) ? require $tokenFile : null;
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET' && HostedDemoSetup::tokenMatches($token, $_GET['setup_key'] ?? null)) {
    setcookie('turnkey_demo_setup', $token, [
        'expires' => time() + 900,
        'path' => '/turnkey-demo-setup.php',
        'secure' => true,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    header('Location: /turnkey-demo-setup.php', true, 303);
    exit;
}
if (! HostedDemoSetup::tokenMatches($token, $_COOKIE['turnkey_demo_setup'] ?? null)) {
    demoPage('Private setup link required', '<p>Open the private demo setup link in your START-HERE file.</p>', 403);
}
if ($method === 'GET') {
    $expiry = (string) (time() + 900);
    $signature = hash_hmac('sha256', 'prepare-demo:'.$expiry, $token);
    demoPage('Prepare the public demo', '<p>This will add fictional service-business data to <code>'.HostedDemoSetup::DATABASE.'</code> and then enable read-only mode.</p><ul><li>8 companies and 12 contacts</li><li>12 opportunities and 16 activities</li><li>4 services and 4 quotes</li><li>Two demo team accounts</li></ul><p>Your administrator account and hosting credentials are preserved. Existing business data will not be overwritten.</p><form method="post" action="/turnkey-demo-setup.php"><input type="hidden" name="action" value="prepare"><input type="hidden" name="expiry" value="'.$expiry.'"><input type="hidden" name="signature" value="'.$signature.'"><button type="submit">Load demo data and enable read-only</button></form><p class="note">Allow up to a minute. If the connection drops, reopen this page: a completed import will be skipped.</p>');
}
if ($method !== 'POST' || ($_POST['action'] ?? null) !== 'prepare'
    || ! HostedDemoSetup::validForm($token, $_POST['expiry'] ?? null, $_POST['signature'] ?? null, time())) {
    demoPage('Confirmation expired', '<p>Refresh this page and use the confirmation button again.</p>', 403);
}

$lock = null;
$app = null;
try {
    if (! is_file($private.'/storage/installed')) {
        throw new LogicException('Complete the initial CRM installation before loading demo data.');
    }
    define('TURNKEY_DEMO_PREPARATION', true);
    require $private.'/setup-access.php';
    if (! defined('TURNKEY_DEMO_GATE_VERSION') || TURNKEY_DEMO_GATE_VERSION !== 1) {
        throw new LogicException('Upload the updated _app/setup-access.php maintenance gate before continuing.');
    }
    if (is_file($private.'/bootstrap/cache/config.php')) {
        throw new LogicException('Remove _app/bootstrap/cache/config.php through the file manager before continuing. The environment must not be cached.');
    }
    $lock = fopen($private.'/storage/framework/turnkey-demo-prepare.lock', 'c');
    if (! $lock || ! flock($lock, LOCK_EX | LOCK_NB)) {
        throw new LogicException('Another setup request is running. Wait for it to finish before trying again.');
    }
    if (is_file($complete)) {
        throw new LogicException('Setup has already completed. Open /admin/login and remove this setup page.');
    }

    $environmentFile = $private.'/.env';
    $original = file_get_contents($environmentFile);
    if ($original === false || ! is_writable($environmentFile) || ! is_writable($private)) {
        throw new LogicException('The private environment file and its directory must be writable to enable read-only mode.');
    }
    HostedDemoSetup::readOnlyContents($original);

    require $private.'/vendor/autoload.php';
    $app = require $private.'/bootstrap/app.php';
    $app->usePublicPath(__DIR__);
    $app->instance('request', Request::capture());
    // Validate the loaded configuration before any application provider can use SQL.
    $app->afterBootstrapping(LoadConfiguration::class, static function ($app): void {
        $config = $app['config'];
        $connection = $config->get('database.connections.'.$config->get('database.default'), []);
        HostedDemoSetup::assertTarget([
            'url' => $config->get('app.url'),
            'environment' => $config->get('app.env'),
            'shared_hosting' => (bool) $config->get('turnkey.shared_hosting', env('TURNKEY_SHARED_HOSTING', false)),
            'driver' => $connection['driver'] ?? '',
            'host' => $connection['host'] ?? '',
            'database' => $connection['database'] ?? '',
            'prefix' => $connection['prefix'] ?? '',
        ]);
        foreach (['url', 'read', 'write', 'unix_socket'] as $override) {
            if (! empty($connection[$override])) {
                throw new LogicException('Database connection overrides are not supported by this dedicated setup page.');
            }
        }
        if ($config->get('session.driver') !== 'file' || $config->get('cache.default') !== 'file') {
            throw new LogicException('File sessions and file cache are required for the read-only hosted demo.');
        }
    });
    $app->make(Kernel::class)->bootstrap();

    // A non-transactional table would make an interrupted import unsafe to retry.
    $tables = Schema::getTables(HostedDemoSetup::DATABASE);
    if ($tables === []) {
        throw new LogicException('No installed CRM tables were found in the dedicated database.');
    }
    foreach ($tables as $table) {
        if (strcasecmp((string) $table['engine'], 'InnoDB') !== 0) {
            throw new LogicException('Every CRM table must use InnoDB before importing the demo. Check table '.(string) $table['name'].'.');
        }
    }

    $seeded = $app->make(CoreConfigRepository::class)->findOneWhere(['code' => 'turnkey.demo.seeded']);

    // Keep public accounts inaccessible even if the request stops after the seed commits.
    if (file_put_contents($preparing, "Demo preparation in progress\n", LOCK_EX) === false || ! is_file($preparing)) {
        throw new LogicException('Cannot close the CRM temporarily for demo preparation.');
    }
    if (! $seeded) {
        if (config('turnkey.read_only')) {
            throw new LogicException('Read-only mode is already enabled but demo data has not been imported. Restore APP_ENV=installation before using this page.');
        }
        config(['turnkey.demo' => true]);
        $app->make(DemoSeeder::class)->run(HostedDemoSetup::DATABASE);
    }

    $counts = [];
    foreach ([
        OrganizationRepository::class => 'companies',
        PersonRepository::class => 'contacts',
        LeadRepository::class => 'opportunities',
        ActivityRepository::class => 'activities',
        ProductRepository::class => 'services',
        QuoteRepository::class => 'quotes',
    ] as $repository => $label) {
        $counts[$label] = $app->make($repository)->count();
    }
    if (! $app->make(UserRepository::class)->findOneWhere(['email' => config('turnkey.demo_email')])) {
        throw new LogicException('The shared demo account is missing. The setup cannot be completed.');
    }
    HostedDemoSetup::activateReadOnly($environmentFile, $original);

    // A failure before this point leaves the maintenance gate closed for a private retry.
    if (! unlink($preparing)) {
        throw new LogicException('Read-only mode is enabled but the maintenance gate remains closed. Retry this private setup page.');
    }
    if (file_put_contents($complete, "Read-only demo activated\n", LOCK_EX) === false) {
        throw new LogicException('Read-only mode is enabled, but the completion marker could not be saved. Remove this setup page now.');
    }
    $summary = '<ul>';
    foreach ($counts as $label => $count) {
        $summary .= '<li>'.(int) $count.' '.demoEscape($label).'</li>';
    }
    $summary .= '</ul><p><strong>Read-only mode is enabled for subsequent CRM requests.</strong></p><p>Sign in with <code>'.demoEscape((string) config('turnkey.demo_email')).'</code><br>Password: <code>'.demoEscape((string) config('turnkey.demo_password')).'</code></p><a class="button" href="/admin/login">Open the demo</a><p class="note">Delete htdocs/turnkey-demo-setup.php and turnkey-check.php through the file manager. Keep the private _app folder in place.</p>';
    setcookie('turnkey_demo_setup', '', ['expires' => time() - 3600, 'path' => '/turnkey-demo-setup.php', 'secure' => true, 'httponly' => true, 'samesite' => 'Strict']);
} catch (Throwable $exception) {
    if (is_resource($lock)) {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
    // Only our explicit operator messages are displayed; SQL errors and secrets stay private.
    $message = $exception instanceof LogicException
        ? $exception->getMessage()
        : 'Preparation could not finish. Check the private _app/storage/logs Laravel log for details. Reopen this page to retry; a completed import will be skipped.';
    if ($app !== null) {
        try {
            report($exception);
        } catch (Throwable) {
            error_log('Turnkey demo setup could not report a preparation failure.');
        }
    }
    demoPage('Preparation stopped', '<p>'.demoEscape($message).'</p><p>Your administrator is preserved. If preparation started, the public CRM stays closed until a successful retry. Do not rerun the installer.</p>', 409);
}

if (is_resource($lock)) {
    flock($lock, LOCK_UN);
    fclose($lock);
}
demoPage('Your demo is ready', $summary);
