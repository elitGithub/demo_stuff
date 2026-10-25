<?php

namespace Tests\Feature;

use App\Services\DeploymentService;
use App\Services\FixtureService;
use DOMDocument;
use DOMXPath;
use PDO;
use RuntimeException;
use Symfony\Component\Process\Process;
use ZipArchive;
use Tests\TestCase;

class DeploymentPackageTest extends TestCase
{
    /** @return void */
    public function test_existing_output_unapproved_roots_and_symbolic_links_fail_before_writing(): void
    {
        $deployment = app(DeploymentService::class);
        $existing = $this->runtime->path('existing');
        mkdir($existing, 0700);
        foreach ([$existing, base_path('storage/app/forbidden-package')] as $output) {
            try {
                $deployment->package($output, $existing);
                $this->fail('Unsafe package output was accepted.');
            } catch (RuntimeException $exception) {
                $this->assertStringContainsString('Package output must be new', $exception->getMessage());
            }
        }
        $linked = $this->runtime->path('linked');
        symlink($existing, $linked);
        try {
            $deployment->resolvedPath($linked.'/output');
            $this->fail('Symbolic build ancestor was accepted.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('symbolic links', $exception->getMessage());
        }
        $this->assertFileDoesNotExist(base_path('storage/app/forbidden-package'));
    }

    /** @return void */
    public function test_clean_production_archive_runs_with_apache_fpm_subdirectory_denials_and_owned_open_basedir(): void
    {
        $fixtures = $this->runtime->path('fixtures');
        app(FixtureService::class)->build($fixtures);
        $developmentAutoloadHash = hash_file('sha256', base_path('vendor/autoload.php'));
        $output = $this->runtime->path('package');
        $archive = app(DeploymentService::class)->package($output, $fixtures);
        $this->assertSame($developmentAutoloadHash, hash_file('sha256', base_path('vendor/autoload.php')));
        $zip = new ZipArchive;
        $this->assertTrue($zip->open($archive));
        $files = 0;
        foreach (range(0, $zip->numFiles - 1) as $index) {
            $name = $zip->getNameIndex($index);
            $this->assertStringStartsWith('stylist-discovery/', $name);
            $this->assertDoesNotMatchRegularExpression('~(?:^|/)(?:\.env(?:\.[^/]*)?|private-config\.php|tests|node_modules)(?:/|$)|(?:-journal|-wal|-shm|\.log)$~', $name);
            if (! str_ends_with($name, '/')) {
                $files++;
            }
        }
        $this->assertLessThan(30000 - 255, $files);
        $this->assertFalse($zip->locateName('stylist-discovery/_app/vendor/phpunit/phpunit/phpunit'));
        $this->assertFalse($zip->locateName('stylist-discovery/_app/vendor/mockery/mockery/composer.json'));
        $this->assertFalse($zip->locateName('stylist-discovery/_app/vendor/laravel/pint/composer.json'));
        foreach (['framework/views', 'framework/sessions', 'framework/cache/data', 'logs'] as $directory) {
            $this->assertSame([], array_values(array_diff(scandir($output.'/stylist-discovery/_app/storage/'.$directory), ['.', '..'])));
        }
        $zip->close();
        $manifest = json_decode(file_get_contents($output.'/manifest.json'), true, flags: JSON_THROW_ON_ERROR);
        $this->assertSame($files, $manifest['files']);
        $this->assertSame(440 * 1024 * 1024, $manifest['runtime_reserve_bytes']);
        $this->assertSame(hash_file('sha256', $archive), $manifest['sha256']);
        $template = new PDO('sqlite:'.$output.'/stylist-discovery/_app/storage/app/demo-runtime/template.sqlite');
        $this->assertNull($template->query('SELECT seed_anchor FROM sandbox_meta')->fetchColumn());
        foreach ($template->query('SELECT password FROM users') as $user) {
            $this->assertSame('argon2id', password_get_info($user['password'])['algoName']);
            $this->assertFalse(password_verify('password', $user['password']));
            $this->assertFalse(password_verify('fictional-password-123', $user['password']));
        }
        $template = null;
        $this->apacheAcceptance($output);
    }

    /** @param string $output @return void */
    protected function apacheAcceptance(string $output): void
    {
        foreach (['/usr/sbin/apache2', '/usr/sbin/php-fpm8.4', '/usr/lib/apache2/modules/mod_proxy_fcgi.so'] as $executable) {
            if (! is_file($executable)) {
                $this->markTestSkipped('Matching Apache/PHP8.4 FPM tooling unavailable; archive checks passed.');
            }
        }
        $server = stream_socket_server('tcp://127.0.0.1:0');
        $address = stream_socket_get_name($server, false);
        fclose($server);
        $port = (int) substr(strrchr($address, ':'), 1);
        $root = $this->runtime->path('http');
        mkdir($root, 0700);
        $socket = $root.'/fpm.sock';
        $outside = $this->runtime->path('outside.txt');
        file_put_contents($outside, 'owned isolated boundary probe');
        file_put_contents($output.'/stylist-discovery/boundary-probe.php', '<?php header("Content-Type: application/json"); echo json_encode(["outside_read_denied" => @file_get_contents('.var_export($outside, true).') === false, "outside_write_denied" => @file_put_contents('.var_export($outside, true).', "forbidden") === false, "open_basedir" => ini_get("open_basedir")]);');
        $user = posix_getpwuid(posix_geteuid())['name'];
        $group = posix_getgrgid(posix_getegid())['name'];
        $fpmConfiguration = $root.'/fpm.conf';
        file_put_contents($fpmConfiguration, "[global]\npid = $root/fpm.pid\nerror_log = $root/fpm.log\ndaemonize = no\n[demo]\nuser = $user\ngroup = $group\nlisten = $socket\npm = static\npm.max_children = 1\nclear_env = yes\nphp_admin_value[open_basedir] = $output:$root\nphp_admin_value[sys_temp_dir] = $root\nphp_admin_value[error_log] = $root/php.log\nphp_admin_flag[display_errors] = off\nphp_admin_value[memory_limit] = 128M\nphp_admin_value[upload_max_filesize] = 5M\nphp_admin_value[post_max_size] = 6M\nphp_admin_value[max_file_uploads] = 1\nphp_admin_value[max_execution_time] = 30\n");
        $apacheConfiguration = $root.'/apache.conf';
        $modules = '';
        foreach (['mpm_event', 'authz_core', 'dir', 'mime', 'rewrite', 'proxy', 'proxy_fcgi'] as $module) {
            $modules .= 'LoadModule '.$module.'_module /usr/lib/apache2/modules/mod_'.$module.".so\n";
        }
        file_put_contents($apacheConfiguration, "ServerRoot \"$root\"\nPidFile \"$root/apache.pid\"\nListen 127.0.0.1:$port\nServerName 127.0.0.1\n$modules\nUser $user\nGroup $group\nErrorLog \"$root/apache.log\"\nLogLevel warn\nTypesConfig /dev/null\nDocumentRoot \"$output\"\n<Directory \"$output\">\nAllowOverride All\nRequire all granted\nOptions FollowSymLinks\n</Directory>\n<FilesMatch \\.php$>\nSetHandler \"proxy:unix:$socket|fcgi://localhost/\"\n</FilesMatch>\n");
        $fpm = new Process(['/usr/sbin/php-fpm8.4', '-F', '-y', $fpmConfiguration], base_path(), timeout: 60);
        $apache = new Process(['/usr/sbin/apache2', '-f', $apacheConfiguration, '-DFOREGROUND'], base_path(), timeout: 60);
        try {
            $fpm->start();
            $deadline = microtime(true) + 5;
            while (! file_exists($socket) && $fpm->isRunning() && microtime(true) < $deadline) {
                usleep(20000);
            }
            $this->assertFileExists($socket, $fpm->getErrorOutput());
            $apache->start();
            $base = 'http://127.0.0.1:'.$port;
            $deadline = microtime(true) + 5;
            do {
                $probe = @stream_socket_client('tcp://127.0.0.1:'.$port, $errorCode, $errorMessage, 0.1);
                if ($probe !== false) {
                    fclose($probe);
                    break;
                }
                usleep(20000);
            } while ($apache->isRunning() && microtime(true) < $deadline);
            $this->assertTrue($apache->isRunning(), $apache->getErrorOutput());
            foreach (['_app/composer.json', '_app/storage/app/demo-runtime/template.sqlite', '.user.ini', 'private-config.example.php', 'x.sqlite-journal', 'private-config.php', '.env'] as $path) {
                $response = $this->http($base.'/stylist-discovery/'.$path);
                $this->assertSame(403, $response['status'], $path);
            }
            $missing = $this->http($base.'/stylist-discovery/');
            $this->assertSame(503, $missing['status']);
            $this->assertStringNotContainsString($output, $missing['body']);
            $configuration = $output.'/stylist-discovery/_app/private-config.php';
            file_put_contents($configuration, '<?php return '.var_export(['APP_KEY' => 'REPLACE_ME'], true).';');
            $this->assertSame(503, $this->http($base.'/stylist-discovery/')['status']);
            $private = $output.'/stylist-discovery/_app';
            file_put_contents($configuration, '<?php return '.var_export([
                'APP_KEY' => 'base64:'.base64_encode(random_bytes(32)), 'APP_URL' => 'https://demo-sites.infinityfree.me/stylist-discovery',
                'LARAVEL_STORAGE_PATH' => $private.'/storage', 'DEMO_RUNTIME_PATH' => $private.'/storage/app/demo-runtime',
                'DEMO_TEMPLATE_PATH' => $private.'/storage/app/demo-runtime/template.sqlite', 'DEMO_REGISTRY_PATH' => $private.'/storage/app/demo-runtime/registry.sqlite',
            ], true).';');
            $landing = $this->http($base.'/stylist-discovery/');
            $this->assertSame(200, $landing['status'], $landing['body'].(is_file($root.'/php.log') ? file_get_contents($root.'/php.log') : ''));
            $this->assertStringContainsString('/stylist-discovery/assets/css/app.css', $landing['body']);
            $this->assertStringContainsString('/stylist-discovery/demo/enter', $landing['body']);
            $this->assertStringContainsString('secure', strtolower(implode("\n", $landing['headers'])));
            $cookie = '';
            foreach ($landing['headers'] as $header) {
                if (preg_match('/^Set-Cookie: (strand_city_session=[^;]+)/i', $header, $matches) === 1) {
                    $cookie = $matches[1];
                }
            }
            $this->assertNotSame('', $cookie);
            preg_match('/name="_token" value="([^"]+)"/', $landing['body'], $matches);
            $entered = $this->http($base.'/stylist-discovery/demo/enter', $cookie, ['_token' => html_entity_decode($matches[1], ENT_QUOTES)]);
            $this->assertSame(302, $entered['status'], $entered['body']);
            foreach ($entered['headers'] as $header) {
                if (preg_match('/^Set-Cookie: (strand_city_session=[^;]+)/i', $header, $matches) === 1) {
                    $cookie = $matches[1];
                }
            }
            $discovery = $this->http($base.'/stylist-discovery/demo/ready', $cookie);
            $this->assertSame(200, $discovery['status'], $discovery['body']);
            $this->assertStringContainsString('Try a booking at Atelier Lune', $discovery['body']);
            $document = new DOMDocument;
            @$document->loadHTML($discovery['body']);
            $xpath = new DOMXPath($document);
            foreach ($xpath->query('//*[@href or @action or @src]') as $element) {
                foreach (['href', 'action', 'src'] as $attribute) {
                    if ($element->hasAttribute($attribute) && ! str_starts_with($element->getAttribute($attribute), '#')) {
                        $this->assertStringStartsWith('/stylist-discovery/', parse_url($element->getAttribute($attribute), PHP_URL_PATH));
                    }
                }
            }
            $profileLink = $xpath->query('//a[contains(normalize-space(.), "Try a booking at Atelier Lune")]')->item(0)->getAttribute('href');
            $profile = $this->http($base.parse_url($profileLink, PHP_URL_PATH), $cookie);
            $this->assertSame(200, $profile['status']);
            $this->assertStringContainsString('/stylist-discovery/bookings/create?service=', $profile['body']);
            foreach (['assets/css/app.css', 'assets/js/app.js', 'assets/seed/stylist-01.svg'] as $asset) {
                $this->assertSame(200, $this->http($base.'/stylist-discovery/'.$asset)['status']);
            }
            $check = $this->http($base.'/stylist-discovery/sqlite-check.php');
            $preflight = json_decode($check['body'], true, flags: JSON_THROW_ON_ERROR);
            $this->assertTrue($preflight['pdo_sqlite']);
            $this->assertTrue($preflight['gd']);
            $this->assertTrue($preflight['argon2id']);
            $this->assertSame('128M', $preflight['memory_limit']);
            $this->assertSame('5M', $preflight['upload_max_filesize']);
            $boundary = json_decode($this->http($base.'/stylist-discovery/boundary-probe.php')['body'], true, flags: JSON_THROW_ON_ERROR);
            $this->assertTrue($boundary['outside_read_denied']);
            $this->assertTrue($boundary['outside_write_denied']);
            $this->assertSame($output.':'.$root, $boundary['open_basedir']);
            $this->assertSame('owned isolated boundary probe', file_get_contents($outside));
            $this->assertCount(3, glob($private.'/storage/app/demo-runtime/*.sqlite'));
            $this->assertFileDoesNotExist($private.'/.env');
            $this->assertFileDoesNotExist($private.'/bootstrap/cache/config.php');
        } finally {
            $apache->stop(2);
            $fpm->stop(2);
        }
    }

    /** @param string $url @param string $cookie @param ?array<string,string> $data @return array{status:int,body:string,headers:array<int,string>} */
    protected function http(string $url, string $cookie = '', ?array $data = null): array
    {
        $headers = ['Connection: close'];
        if ($cookie !== '') {
            $headers[] = 'Cookie: '.$cookie;
        }
        if ($data !== null) {
            $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        }
        $context = stream_context_create(['http' => ['method' => $data === null ? 'GET' : 'POST', 'header' => implode("\r\n", $headers), 'content' => $data === null ? '' : http_build_query($data), 'ignore_errors' => true, 'follow_location' => 0, 'timeout' => 10]]);
        $body = file_get_contents($url, false, $context);
        $responseHeaders = http_get_last_response_headers();
        $this->assertNotFalse($body);
        preg_match('/^HTTP\/\S+ (\d+)/', $responseHeaders[0], $matches);

        return ['status' => (int) $matches[1], 'body' => $body, 'headers' => $responseHeaders];
    }
}
