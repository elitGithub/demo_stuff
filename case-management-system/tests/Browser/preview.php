<?php

use App\Enums\CaseStatus;
use App\Enums\MailboxLabel;
use App\Models\CaseMessage;
use App\Models\CaseRecord;
use App\Models\MailboxMessage;
use App\Models\TrackedSender;
use App\Models\User;
use App\Notifications\CaseCreated;
use App\Support\SenderAddress;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Console\Kernel as ConsoleKernel;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;

$project = dirname(__DIR__, 2);
$runtime = $project.'/storage/framework/testing/css-audit-20261018';
$private = $runtime.'/private';
$database = $private.'/casefile.sqlite';
$action = PHP_SAPI === 'cli' ? ($argv[1] ?? '') : 'http';

if (! in_array($action, ['prepare', 'fixtures', 'cleanup-private', 'http'], true)) {
    throw new RuntimeException('Expected prepare, fixtures or cleanup-private.');
}

for ($path = $runtime; $path !== '/'; $path = dirname($path)) {
    if (is_link($path) || (file_exists($path) && realpath($path) !== $path)) {
        throw new RuntimeException('Audit runtime ancestors must not be symlinks.');
    }
}

if (is_link($private)) {
    throw new RuntimeException('Audit private root must not be a symlink.');
}

if ($action === 'cleanup-private') {
    if (count($argv) !== 2 || realpath($private) !== $private) {
        throw new RuntimeException('Cleanup requires the exact existing audit private root.');
    }

    $entries = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($private, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($entries as $entry) {
        if ($entry->isLink() || ! str_starts_with($entry->getRealPath(), $private.'/')) {
            throw new RuntimeException('Cleanup refuses symlinks or path escapes.');
        }
    }
    foreach ($entries as $entry) {
        $removed = $entry->isDir() ? rmdir($entry->getPathname()) : unlink($entry->getPathname());
        if (! $removed) {
            throw new RuntimeException('Could not remove generated private audit entry.');
        }
    }
    echo "Removed generated private audit contents. Public builds preserved.\n";
    exit(0);
}

if ($action === 'prepare') {
    if (count($argv) !== 2 || file_exists($database) || is_link($database)
        || file_exists($database.'.building') || is_link($database.'.building')
        || file_exists($private.'/application.key')) {
        throw new RuntimeException('Preparation refuses an existing audit database, build file or key.');
    }

    foreach (['', '/private', '/private/environment', '/private/cache', '/private/framework/sessions', '/private/framework/views', '/private/framework/cache/data', '/private/logs', '/private/app/private', '/private/app/public', '/public'] as $suffix) {
        $directory = $runtime.$suffix;
        if (is_link($directory) || (! is_dir($directory) && ! mkdir($directory, str_starts_with($suffix, '/private') ? 0700 : 0755, true))) {
            throw new RuntimeException('Cannot create isolated audit directory.');
        }
        if (realpath($directory) !== $directory) {
            throw new RuntimeException('Audit directories must be canonical.');
        }
    }
    $keyFile = fopen($private.'/application.key', 'x');
    if ($keyFile === false) {
        throw new RuntimeException('Cannot create private audit key.');
    }
    chmod($private.'/application.key', 0600);
    fwrite($keyFile, 'base64:'.base64_encode(random_bytes(32)));
    fclose($keyFile);
}

if ($action === 'fixtures') {
    if (count($argv) !== 4 || ! preg_match('/\A--unread=(0|1|2|10|100)\z/', $argv[2], $unreadMatch)
        || ! preg_match('/\A--content=(normal|long|paged)\z/', $argv[3], $contentMatch)) {
        throw new RuntimeException('Fixtures require --unread=0|1|2|10|100 --content=normal|long|paged.');
    }
}

if ($action !== 'prepare' && (realpath($database) !== $database || is_link($database))) {
    throw new RuntimeException('The exact isolated audit database must exist.');
}

if ($action === 'http') {
    if (PHP_SAPI !== 'cli-server' || ! in_array($_SERVER['REMOTE_ADDR'], ['127.0.0.1', '::1'], true)) {
        http_response_code(403);
        exit('Loopback preview only.');
    }

    $requestPath = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
    if (str_contains($requestPath, "\0") || str_contains($requestPath, '\\')
        || preg_match('#(?:^|/)\.{1,2}(?:/|$)#', $requestPath)
        || str_contains($requestPath, '/private') || str_starts_with($requestPath, '/.')) {
        http_response_code(404);
        exit('Not found.');
    }

    if (str_starts_with($requestPath, '/build/')) {
        $buildRoot = realpath($runtime.'/public/build');
        $file = realpath($runtime.'/public'.$requestPath);
        if ($buildRoot === false || $buildRoot !== $runtime.'/public/build'
            || $file === false || ! str_starts_with($file, $buildRoot.'/') || ! is_file($file)) {
            http_response_code(404);
            exit('Not found.');
        }
        $mime = match (pathinfo($file, PATHINFO_EXTENSION)) {
            'css' => 'text/css', 'js', 'mjs' => 'text/javascript', 'json' => 'application/json',
            'woff2' => 'font/woff2', 'woff' => 'font/woff', 'ttf' => 'font/ttf',
            'svg' => 'image/svg+xml', default => 'application/octet-stream',
        };
        header('Content-Type: '.$mime);
        header('X-Content-Type-Options: nosniff');
        readfile($file);
        exit;
    }
}

$app = require __DIR__.'/bootstrap.php';

if ($action !== 'http') {
    $app->make(ConsoleKernel::class)->bootstrap();
    set_exception_handler(function (Throwable $exception): void {
        fwrite(STDERR, $exception->getMessage().PHP_EOL);
        exit(1);
    });

    if ($action === 'prepare') {
        $exitCode = Artisan::call('casefile:build-template', ['--path' => $database, '--no-interaction' => true]);
        if ($exitCode !== 0) {
            throw new RuntimeException('Approved template preparation failed: '.Artisan::output());
        }
        echo Artisan::output();
        echo 'Audit runtime: '.$runtime.PHP_EOL;
        echo json_encode(['cases' => CaseRecord::query()->count(), 'senders' => TrackedSender::query()->count(), 'mailbox_messages' => MailboxMessage::query()->count()], JSON_THROW_ON_ERROR).PHP_EOL;
        exit(0);
    }

    $unread = (int) $unreadMatch[1];
    $content = $contentMatch[1];
    DB::transaction(function () use ($content, $unread): void {
        CaseRecord::query()->where('thread_id', 'like', 'css-audit-%')->delete();
        MailboxMessage::query()->where('gmail_message_id', 'like', 'css-audit-%')->delete();
        TrackedSender::query()->where('email', 'like', 'css-audit-%@mail.example')->delete();

        $case = CaseRecord::query()->where('number', 'CASE-0016')->firstOrFail();
        $seedCases = require database_path('seeders/data/cases.php');
        $originalCase = collect($seedCases)->firstWhere('number', 'CASE-0016');
        $originalAddress = SenderAddress::fromHeader($originalCase['sender']);
        $seedSenders = require database_path('seeders/data/senders.php');
        $originalSender = collect($seedSenders)->first(fn (array $row): bool => SenderAddress::fromHeader($row['header'])->email === $originalAddress->email);
        $originalSenderAddress = SenderAddress::fromHeader($originalSender['header']);
        $sender = $case->trackedSender;
        $previousEmail = $sender->email;
        $name = $content === 'long' ? str_repeat('N', 120) : $originalSenderAddress->name;
        $email = $content === 'long' ? str_repeat('a', 64).'@'.str_repeat('b', 63).'.example' : $originalAddress->email;
        $sender->update(['name' => $name, 'email' => $email, 'label' => $content === 'long' ? str_repeat('L', 60) : $originalSender['label']]);
        CaseRecord::query()->where('tracked_sender_id', $sender->id)->update(['sender_name' => $name, 'sender_email' => $email]);
        foreach ([CaseMessage::class, MailboxMessage::class] as $messageModel) {
            $messageModel::query()->where('from_email', $previousEmail)->update(['from_name' => $name, 'from_email' => $email]);
            $messageModel::query()->where('to_email', $previousEmail)->update(['to_email' => $email]);
        }
        $case->update([
            'subject' => $content === 'long' ? str_repeat('W', 200) : $originalCase['subject'],
            'issue' => $content === 'long' ? substr(str_repeat('Long issue '.str_repeat('W', 90).' ', 50), 0, 5000) : $originalCase['issue'],
            'notes' => $content === 'long' ? substr(str_repeat('Long notes '.str_repeat('W', 90).' ', 50), 0, 5000) : $originalCase['notes'],
        ]);

        if ($content === 'paged') {
            $timestamp = CarbonImmutable::parse('2026-10-18 09:00:00', 'UTC');
            $sequence = 9001;
            foreach (CaseStatus::cases() as $status) {
                for ($index = 0; $index < 12; $index++) {
                    CaseRecord::factory()->create([
                        'number' => 'CASE-'.$sequence, 'thread_id' => 'css-audit-case-'.$sequence,
                        'status' => $status, 'tracked_sender_id' => $sender->id,
                        'subject' => 'CSS audit pagination '.$sequence,
                        'received_at' => $timestamp->subMinutes($sequence - 9001),
                        'closed_at' => $status === CaseStatus::Closed ? $timestamp : null,
                        'created_at' => $timestamp, 'updated_at' => $timestamp,
                    ]);
                    $sequence++;
                }
            }
            for ($index = 1; $index <= 26; $index++) {
                TrackedSender::factory()->create([
                    'email' => 'css-audit-'.$index.'@mail.example', 'name' => 'CSS audit sender '.$index,
                    'label' => 'Audit pagination', 'is_active' => true,
                    'created_at' => $timestamp, 'updated_at' => $timestamp,
                ]);
            }
            for ($index = 1; $index <= 51; $index++) {
                MailboxMessage::factory()->create([
                    'gmail_message_id' => 'css-audit-message-'.$index, 'thread_id' => 'css-audit-mail-'.$index,
                    'label' => MailboxLabel::Inbox, 'from_email' => 'css-audit-'.$index.'@mail.example',
                    'from_name' => 'CSS audit correspondent '.$index, 'subject' => 'CSS audit Inbox '.$index,
                    'body_text' => 'Fictional pagination fixture.', 'snippet' => 'Fictional pagination fixture.',
                    'received_at' => $timestamp->subMinutes($index), 'created_at' => $timestamp, 'updated_at' => $timestamp,
                ]);
            }
        }

        $owner = User::query()->where('email', config('casefile.owner.email'))->firstOrFail();
        $owner->notifications()->delete();
        for ($index = 0; $index < $unread; $index++) {
            $owner->notify(new CaseCreated(case: $case->fresh()));
        }
        if ($owner->unreadNotifications()->count() !== $unread
            || CaseRecord::query()->where('thread_id', 'like', 'css-audit-%')->count() !== ($content === 'paged' ? 36 : 0)
            || TrackedSender::query()->where('email', 'like', 'css-audit-%@mail.example')->count() !== ($content === 'paged' ? 26 : 0)
            || MailboxMessage::query()->where('gmail_message_id', 'like', 'css-audit-%')->count() !== ($content === 'paged' ? 51 : 0)) {
            throw new RuntimeException('Audit fixture counts do not match the requested state.');
        }
    });
    echo json_encode(['content' => $content, 'unread' => $unread, 'cases' => CaseRecord::query()->count(), 'senders' => TrackedSender::query()->count(), 'mailbox_messages' => MailboxMessage::query()->count()], JSON_THROW_ON_ERROR).PHP_EOL;
    exit(0);
}

$kernel = $app->make(HttpKernel::class);
$kernel->bootstrap();
Route::middleware('web')->get('/__css-audit/429', fn () => response()->view('errors.429', ['notice' => 'This is a simulated rate limit for the isolated CSS audit.'], 429));
$request = Request::capture();
$response = $kernel->handle($request);

if ($request->query('__css_audit_storage') === 'blocked' && str_contains((string) $response->headers->get('Content-Type'), 'text/html')) {
    $script = '<script>Object.defineProperty(window,"localStorage",{configurable:true,get(){throw new DOMException("CSS audit storage denial","SecurityError")}});</script>';
    $response->setContent(str_replace('<head>', '<head>'.$script, $response->getContent()));
}

$response->send();
$kernel->terminate($request, $response);
