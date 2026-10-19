#!/usr/bin/env python3
"""Exercise the release package with real parallel Apache and PHP-FPM workers, and bin/router.php on a copy of site/."""
import concurrent.futures
import contextlib
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
checks = 0


def check(condition, description):
    global checks
    assert condition, description
    checks += 1
    print('PASS', description, flush=True)


def php_string(value):
    return "'" + str(value).replace('\\', '\\\\').replace("'", "\\'") + "'"


def wait_output(process):
    assert select.select([process.stdout], [], [], 10)[0], 'worker did not signal readiness'
    assert process.stdout.readline().strip() == 'READY', process.stderr.read() if process.poll() is not None else 'worker failed'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *arguments):
        return None


def unfollowed(url):
    try:
        response = urllib.request.build_opener(NoRedirect).open(url, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers


def run_packager(script_root, output):
    result = subprocess.run(['php', 'bin/package.php', '--output', str(output)], cwd=script_root, capture_output=True, text=True)
    report = dict(line.split(': ', 1) for line in result.stdout.splitlines() if ': ' in line)
    return result, report


def packaged(name):
    relative = name.removeprefix('travel-agency-demo/')
    return not (re.search(r'\.sqlite', relative, re.IGNORECASE) or relative.lower().endswith('.log') or (relative.startswith('private/sandboxes/') and relative != 'private/sandboxes/.htaccess'))


PAGES = [
    ('index.php', ['app.js'], '<h1>Go somewhere<br>that <em>stays<br>with you.</em></h1>'),
    ('destinations.php', ['app.js'], '<h1>So many places.<br><em>So many possibilities.</em></h1>'),
    ('journeys.php', ['app.js'], '<h1>There’s a journey<br><em>with your name on it.</em></h1>'),
    ('about.php', ['app.js'], '<h1>More than a place.<br><em>A way of feeling.</em></h1>'),
    ('journal.php', ['app.js'], '<h1>The Elsewhere<br><em>journal.</em></h1>'),
    ('contact.php', ['sandbox.js', 'app.js'], '<h1>A little hello.<br><em>A world of possibility.</em></h1>'),
    ('admin.php', ['sandbox.js', 'dashboard-pagination.js', 'app.js', 'admin.js'], '<h1>A thoughtful trip.<br><em>A clear overview.</em></h1>'),
]
HOME_HEADING = PAGES[0][2]


class Client:
    def __init__(self, origin):
        self.origin = origin
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.context = None

    def request(self, path, data=None, method=None, headers=None):
        selected_headers = {} if headers is None else dict(headers)
        if data is not None:
            selected_headers.setdefault('Content-Type', 'application/json')
        raw = data if isinstance(data, bytes) else None if data is None else json.dumps(data, ensure_ascii=False).encode()
        request = urllib.request.Request(self.origin + path, data=raw, headers=selected_headers, method=method)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers

    def api(self, route, data=None, method=None, headers=None, origin=True, context=True):
        selected_headers = {} if headers is None else dict(headers)
        if origin:
            selected_headers.setdefault('Origin', self.origin)
        if context and self.context is not None:
            selected_headers.setdefault('X-Elsewhere-Context', self.context)
        status, raw, response_headers = self.request('/travel-agency-demo/api.php?route=' + urllib.parse.quote(route, safe=''), data, method, selected_headers)
        try:
            result = json.loads(raw)
        except ValueError:
            raise AssertionError(f'Non-JSON response {status}: {raw[:500]!r}')
        assert response_headers.get('Cache-Control') == 'no-store', response_headers
        return status, result, response_headers

    def initialize(self):
        status, payload, headers = self.api('sandbox', {})
        assert status == 200, (status, payload)
        self.context = payload['csrfToken']
        return payload, headers

    def login(self):
        assert self.api('admin/login', {})[0] == 200

    def cookie(self, name):
        return next(cookie.value for cookie in self.jar if cookie.name == name)


def stop(process):
    if process is None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill(); process.wait()


fixture_parent = ROOT / 'storage/test-runs'
fixture_parent.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='infinityfree-', dir=fixture_parent) as temporary:
    temp = Path(temporary)
    with socket.socket() as reserved_socket:
        reserved_socket.bind(('127.0.0.1', 0))
        port = reserved_socket.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    package = temp / 'package'
    build, report = run_packager(ROOT, package)
    check(build.returncode == 0 and build.stderr == '', 'package.php builds the release archive' + ('' if build.returncode == 0 else ': ' + build.stderr))
    archive_path = package / 'travel-demo.zip'
    archive_hash = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    check(sorted(report) == ['bytes', 'files', 'path', 'sha256'] and report['path'] == str(archive_path.resolve()) and int(report['bytes']) == archive_path.stat().st_size and report['sha256'] == archive_hash, 'package.php prints path, bytes, files and sha256 of the archive')
    check([entry.name for entry in package.iterdir()] == ['travel-demo.zip'], 'package output holds only the archive')
    refused = run_packager(ROOT, package)[0]
    check(refused.returncode != 0 and 'new or empty' in refused.stderr and hashlib.sha256(archive_path.read_bytes()).hexdigest() == archive_hash, 'second package run into the same output is refused with new or empty')
    check(not (ROOT / 'deploy/infinityfree/preflight.php').exists(), 'no preflight script remains')
    web = temp / 'web'
    web.mkdir()
    (web / 'index.html').write_text('ROOT HUB SENTINEL')
    stale_classes = web / 'travel-agency-demo/private/classes'
    stale_classes.mkdir(parents=True)
    stale_names = ['Registry.php', 'RateBucket.php', 'SandboxState.php']
    for name in stale_names:
        (stale_classes / name).write_text("<?php throw new Error('stale class loaded');")
    stale_page = web / 'travel-agency-demo/index.html'
    stale_page.write_text('STALE HTML SENTINEL')
    site = ROOT / 'site'
    with zipfile.ZipFile(archive_path) as archive:
        files = archive.namelist()
        check(len(files) > 30 and len(files) == int(report['files']) and all(name.startswith('travel-agency-demo/') for name in files), 'package_is_only_elsewhere')
        check(not any(name.endswith(('.sqlite', '.db', '.zip', '.log', '.mjs')) or re.search(r'\.sqlite|runtime|registry\.|preflight|test-runs|root-index|/bin/|/tests/', name) for name in files), 'package excludes runtime, build and test state')
        check([name for name in files if name.startswith('travel-agency-demo/private/sandboxes/')] == ['travel-agency-demo/private/sandboxes/.htaccess'] and 'travel-agency-demo/private/registry-schema.sql' in files, 'package ships the sandboxes folder guard and registry schema')
        site_files = sorted(str(path.relative_to(site)) for path in site.rglob('*') if path.is_file() and packaged(str(path.relative_to(site))))
        check(sorted(name.removeprefix('travel-agency-demo/') for name in files) == site_files and all(archive.read(name) == (site / name.removeprefix('travel-agency-demo/')).read_bytes() for name in files), 'archive mirrors site/ byte for byte, dotfiles included')
        check(archive.read('travel-agency-demo/private/.htaccess') == b'Require all denied\n' and archive.read('travel-agency-demo/private/sandboxes/.htaccess') == b'Require all denied\n', 'private and sandboxes guards deny all')
        committed_config = archive.read('travel-agency-demo/private/config.php').decode()
        check("__DIR__.'/sandboxes'" in committed_config and re.search(r"sandbox_root.*__DIR__.*/sandboxes'", committed_config) and not re.search(r'test|clock|visitor|csrfToken', committed_config), 'committed config.php uses the private sandboxes folder and no test state')
        archive.extractall(web)
    private = web / 'travel-agency-demo/private'
    check(all((stale_classes / name).read_text() == "<?php throw new Error('stale class loaded');" for name in stale_names), 'stale 2026-10-18 class sentinels survive the overwrite extract')
    check(stale_page.read_text() == 'STALE HTML SENTINEL', 'stale index.html survives the overwrite extract')
    origin_probes = [subprocess.run(['php', '-r', 'echo (require $argv[1])["origin"];', str(private / 'config.php')], capture_output=True, text=True, env=environment) for environment in [{'PATH': os.environ['PATH']}, {'PATH': os.environ['PATH'], 'ELSEWHERE_ORIGIN': 'http://127.0.0.1:1'}]]
    check(all(probe.returncode == 0 and probe.stdout == 'https://demo-sites.infinityfree.me' and probe.stderr == '' for probe in origin_probes), 'packaged config.php returns the hosted origin without the router constant, whatever the environment')
    check((private / 'sandboxes').is_dir() and (private / 'sandboxes/.htaccess').read_text() == 'Require all denied\n', 'extraction creates the private sandboxes folder')

    tree = temp / 'local-run'
    shutil.copytree(site, tree / 'site')
    (tree / 'bin').mkdir()
    for script in ['router.php', 'package.php']:
        shutil.copyfile(ROOT / 'bin' / script, tree / 'bin' / script)
    local_sandboxes = tree / 'site/private/sandboxes'
    with socket.socket() as reserved_socket:
        reserved_socket.bind(('127.0.0.1', 0))
        router_port = reserved_socket.getsockname()[1]
    router_origin = f'http://127.0.0.1:{router_port}'
    router_log_path = temp / 'router.log'
    router_log = router_log_path.open('w')
    router = subprocess.Popen(['php', '-S', f'127.0.0.1:{router_port}', 'bin/router.php'], cwd=tree, env={**os.environ, 'ELSEWHERE_ORIGIN': router_origin}, stdout=router_log, stderr=router_log, start_new_session=True)
    try:
        local = Client(router_origin)
        for attempt in range(50):
            try:
                local.request('/travel-agency-demo/robots.txt')
                break
            except (urllib.error.URLError, ConnectionError):
                if router.poll() is not None:
                    raise AssertionError(router_log_path.read_text())
                time.sleep(.1)
        redirect_status, redirect_headers = unfollowed(router_origin + '/')
        check(redirect_status == 302 and redirect_headers.get('Location') == '/travel-agency-demo/', 'router redirects / to /travel-agency-demo/')
        status, raw = local.request('/travel-agency-demo/')[:2]
        check(status == 200 and HOME_HEADING.encode() in raw, 'router folder URL serves index.php')
        for page, scripts, heading in PAGES:
            status, raw = local.request('/travel-agency-demo/' + page)[:2]
            check(status == 200 and heading.encode() in raw, 'router renders ' + page)
        status, raw, headers = local.request('/travel-agency-demo/assets/styles.css')
        check(status == 200 and headers.get('Content-Type', '').startswith('text/css') and raw == (site / 'assets/styles.css').read_bytes(), 'router streams assets/styles.css as text/css')
        for path in ['private', 'private/', 'private/config.php', 'private/catalog.json', 'private/views/layout.php', 'private/views/pages/index.php', 'private/classes/ApiController.php', 'private/sandboxes/.htaccess', '.htaccess', 'assets/%2e%2e/private/config.php', '/private/config.php', 'PRIVATE/config.php', 'Private/views/layout.php']:
            check(local.request('/travel-agency-demo/' + path)[0] == 403, 'router denial: ' + path)
        for path in ['nope.php', 'assets/nope.css', 'assets/', 'api.php/extra']:
            check(local.request('/travel-agency-demo/' + path)[0] == 404, 'router not found: ' + path)
        before = sorted(entry.name for entry in local_sandboxes.iterdir())
        bootstrap = local.api('sandbox', {})
        runtime_files = sorted(set(entry.name for entry in local_sandboxes.iterdir()) - set(before))
        check(bootstrap[0] == 200 and bootstrap[1]['created'] and 'registry.sqlite' in (before + runtime_files) and any(re.fullmatch(r'[0-9a-f]{64}\.sqlite', name) for name in runtime_files), 'router bootstrap leaves runtime files in the copied site/private/sandboxes/')
        check(local.request('/travel-agency-demo/private/sandboxes/registry.sqlite')[0] == 403, 'router denies the live registry')
        (local_sandboxes / 'stale.sqlite-journal').write_text('FICTIONAL JOURNAL SENTINEL')
        (tree / 'site/assets/stale.sqlite-journal').write_text('FICTIONAL JOURNAL SENTINEL')
        (tree / 'site/assets/debug.log').write_text('FICTIONAL LOG SENTINEL')
        local_build, local_report = run_packager(tree, temp / 'local-package')
        check(local_build.returncode == 0 and int(local_report['files']) == len(files), 'package after a local run succeeds with the same file count')
        with zipfile.ZipFile(temp / 'local-package/travel-demo.zip') as local_archive:
            local_files = local_archive.namelist()
        check(sorted(local_files) == sorted(files) and not any(name.endswith('/' + runtime) for name in local_files for runtime in runtime_files + ['registry.sqlite', 'stale.sqlite-journal', 'debug.log']), 'package after a local run excludes every runtime file')
        check(all((local_sandboxes / name).exists() for name in runtime_files), 'packaging leaves the local runtime files in place')
        inside_site = run_packager(tree, tree / 'site/newbuild')[0]
        check(inside_site.returncode != 0 and 'outside the site folder' in inside_site.stderr and not (tree / 'site/newbuild').exists(), 'output inside site/ is refused and creates no folder')
        escaping = run_packager(tree, tree / 'missing/../site/escape')[0]
        check(escaping.returncode != 0 and 'outside the site folder' in escaping.stderr and not (tree / 'site/escape').exists() and not (tree / 'missing').exists(), 'output reaching site/ through .. is refused and creates no folder')
        default_build = subprocess.run(['php', 'bin/package.php'], cwd=tree, capture_output=True, text=True)
        default_folders = list((tree / 'deploy/builds').iterdir()) if (tree / 'deploy/builds').is_dir() else []
        check(default_build.returncode == 0 and len(default_folders) == 1 and re.fullmatch(r'\d{8}-\d{6}', default_folders[0].name) and (default_folders[0] / 'travel-demo.zip').is_file(), 'default output is deploy/builds/<date>-<time>/')
        (tree / 'site/assets/notes.bak').write_text('FICTIONAL STRAY SENTINEL')
        stray = run_packager(tree, temp / 'stray-package')[0]
        check(stray.returncode != 0 and 'assets/notes.bak' in stray.stderr and not (temp / 'stray-package').exists(), 'a file outside the allowlist fails packaging by name and creates no ZIP or folder')
    finally:
        stop(router)
        router_log.close()
    error_log = private / 'sandboxes/php-errors.log'
    legacy = private / 'runtime'
    legacy.mkdir()
    (legacy / 'demo.sqlite').write_bytes(b'LEGACY SQLITE SENTINEL')
    (legacy / 'session-old').write_bytes(b'LEGACY SESSION SENTINEL')
    runtime_root = None

    def configure(name, overrides=None, external_origin=None, create=True, root=None):
        global runtime_root
        runtime_root = private / ('fixture-' + name) if root is None else root
        if create:
            runtime_root.mkdir()
        values = {} if overrides is None else overrides
        config_text = "<?php\nreturn ['origin' => " + php_string(external_origin or origin) + ", 'base_path' => '/travel-agency-demo', 'sandbox_root' => " + php_string(runtime_root) + ", 'sandbox' => json_decode(" + php_string(json.dumps(values)) + ")];\n"
        (private / 'config.php').write_text(config_text)
        return runtime_root

    def untouched():
        return not (runtime_root / 'registry.sqlite').exists()

    def log_offset(log=None):
        selected = error_log if log is None else log
        return selected.stat().st_size if selected.exists() else 0

    def logged_since(offset, log=None):
        selected = error_log if log is None else log
        return selected.read_bytes()[offset:].decode() if selected.exists() else ''

    def registry():
        with contextlib.closing(sqlite3.connect((runtime_root / 'registry.sqlite').as_uri() + '?mode=ro', uri=True)) as connection:
            connection.row_factory = sqlite3.Row
            return {
                'sandboxes': {row['digest']: dict(row) for row in connection.execute('SELECT digest, csrfToken, dashboardDigest, lastActivity FROM sandboxes ORDER BY rowid')},
                'rateBuckets': {row['key']: dict(row) for row in connection.execute('SELECT key, hits, expiresAt FROM rate_buckets ORDER BY key')},
            }

    def save_registry(value):
        with contextlib.closing(sqlite3.connect((runtime_root / 'registry.sqlite').as_uri() + '?mode=rw', uri=True)) as connection, connection:
            connection.execute('DELETE FROM sandboxes')
            connection.execute('DELETE FROM rate_buckets')
            connection.executemany('INSERT INTO sandboxes (digest, csrfToken, dashboardDigest, lastActivity) VALUES (:digest, :csrfToken, :dashboardDigest, :lastActivity)', list(value['sandboxes'].values()))
            connection.executemany('INSERT INTO rate_buckets (key, hits, expiresAt) VALUES (:key, :hits, :expiresAt)', list(value['rateBuckets'].values()))

    def database(client):
        return runtime_root / (hashlib.sha256(client.cookie('elsewhere_sandbox_v1').encode()).hexdigest() + '.sqlite')

    def php_worker(code):
        return subprocess.Popen(['php', '-r', code], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    configure('main')
    php_temp = temp / 'php-tmp'
    php_temp.mkdir()
    fpm_socket = temp / 'php-fpm.sock'
    fpm_log = temp / 'php-fpm.log'
    fpm_config = temp / 'php-fpm.conf'
    fpm_config.write_text(f'''[global]
pid = {temp}/php-fpm.pid
error_log = {fpm_log}

[elsewhere]
listen = {fpm_socket}
pm = static
pm.max_children = 8
catch_workers_output = yes
php_admin_value[open_basedir] = {web}/:{php_temp}/
php_admin_value[sys_temp_dir] = {php_temp}
php_admin_value[upload_tmp_dir] = {php_temp}
php_admin_value[disable_functions] = putenv
php_admin_value[display_errors] = Off
php_admin_value[opcache.enable] = 0
''')
    modules = Path('/usr/lib/apache2/modules')
    apache_config = temp / 'apache.conf'
    apache_config.write_text(f'''ServerRoot "{temp}"
PidFile "{temp}/apache.pid"
ServerName localhost
Listen 127.0.0.1:{port}
LoadModule mpm_prefork_module {modules}/mod_mpm_prefork.so
LoadModule authz_core_module {modules}/mod_authz_core.so
LoadModule dir_module {modules}/mod_dir.so
LoadModule mime_module {modules}/mod_mime.so
LoadModule rewrite_module {modules}/mod_rewrite.so
LoadModule headers_module {modules}/mod_headers.so
LoadModule proxy_module {modules}/mod_proxy.so
LoadModule proxy_fcgi_module {modules}/mod_proxy_fcgi.so
StartServers 4
MinSpareServers 4
MaxSpareServers 8
MaxRequestWorkers 8
TypesConfig /etc/mime.types
ErrorLog "{temp}/error.log"
LogLevel warn
DocumentRoot "{web}"
<Directory "{web}">
    Options FollowSymLinks
    AllowOverride AuthConfig FileInfo Indexes Options=Indexes
    Require all granted
</Directory>
<FilesMatch "\\.php$">
    SetHandler "proxy:unix:{fpm_socket}|fcgi://localhost"
</FilesMatch>
''')
    process_log = (temp / 'process.log').open('w')
    fpm = subprocess.Popen(['/usr/sbin/php-fpm8.4', '-F', '-y', str(fpm_config), '-p', str(temp)], stdout=process_log, stderr=process_log, start_new_session=True)
    apache = None
    try:
        for attempt in range(50):
            if fpm_socket.exists():
                break
            if fpm.poll() is not None:
                raise AssertionError((temp / 'process.log').read_text())
            time.sleep(.1)
        else:
            raise AssertionError('php-fpm did not open its socket')
        apache = subprocess.Popen(['apache2', '-f', str(apache_config), '-DFOREGROUND'], stdout=process_log, stderr=process_log, start_new_session=True)
        public = Client(origin)
        for attempt in range(50):
            try:
                public.request('/')
                break
            except (urllib.error.URLError, ConnectionError):
                if apache.poll() is not None:
                    raise AssertionError((temp / 'error.log').read_text() if (temp / 'error.log').exists() else (temp / 'process.log').read_text())
                time.sleep(.1)
        check(public.request('/')[1] == b'ROOT HUB SENTINEL', 'root hub remains byte-identical')
        sqlite_check = web / 'travel-agency-demo/sqlite-check.php'
        sqlite_check.write_bytes((ROOT / 'deploy/infinityfree/sqlite-check.php').read_bytes())
        status, raw, headers = public.request('/travel-agency-demo/sqlite-check.php')
        check(status == 200 and headers.get('Content-Type', '').startswith('text/plain') and raw.decode().split('\n')[1:] == ['pdo_sqlite: yes', ''] and raw.startswith(b'PHP 8.4.'), 'sqlite check prints the PHP version and pdo_sqlite on two lines')
        sqlite_check.unlink()
        status, raw, headers = public.request('/travel-agency-demo/')
        check(status == 200 and b'STALE HTML SENTINEL' not in raw and HOME_HEADING.encode() in raw, 'folder URL serves index.php')
        versions = {name: hashlib.sha256((web / 'travel-agency-demo/assets' / name).read_bytes()).hexdigest()[:10] for name in ['styles.css', 'sandbox.js', 'dashboard-pagination.js', 'app.js', 'admin.js']}
        for page, scripts, heading in PAGES:
            status, raw, headers = public.request('/travel-agency-demo/' + page)
            text = raw.decode()
            check(status == 200 and '<meta name="api-endpoint" content="api.php">' in text, 'page served with the api endpoint: ' + page)
            check("script-src 'self'" in headers.get('Content-Security-Policy', ''), 'CSP: ' + page)
            found = re.findall(r'<script src="assets/([a-z-]+\.js)\?v=([0-9a-f]{10})" defer></script>', text)
            check(text.count('<script') == len(scripts) and [script for script, version in found] == scripts and all(version == versions[script] for script, version in found) and f'href="assets/styles.css?v={versions["styles.css"]}"' in text, 'scripts in order with content versions: ' + page)
            check(heading in text, 'main heading: ' + page)
            if page == 'journeys.php':
                check('Culture &amp; discovery' in text and 'Culture & discovery' not in text, 'catalog ampersands render escaped on the journeys page')
        for path in ['assets/styles.css', 'assets/sandbox.js', 'assets/dashboard-pagination.js', 'assets/app.js', 'assets/admin.js', 'assets/fonts/dm-serif.ttf', 'assets/images/hero-lake.jpg']:
            check(public.request('/travel-agency-demo/' + path)[0] == 200, 'asset: ' + path)
        for path in ['private/', 'private/config.php', 'private/demo-seed.json', 'private/sandbox.json', 'private/schema.sql', 'private/registry-schema.sql', 'private/api.php', 'private/catalog.json', 'private/enquiry-budgets.json', 'private/views/layout.php', 'private/views/pages/index.php', 'private/classes/ApiController.php', 'private/classes/SandboxRuntime.php', 'private/runtime/demo.sqlite', 'private/sandboxes/', 'private/sandboxes/.htaccess', '.htaccess']:
            check(public.request('/travel-agency-demo/' + path)[0] == 403, 'private denial: ' + path)
        check(public.api('admin/overview')[1]['code'] == 'sandbox_context', 'missing generation precedes dashboard authorization')
        check(public.api('sandbox', {}, origin=False)[0] == 403, 'missing Origin rejected')
        check(untouched(), 'rejected request performs no runtime access')
        check(public.api('sandbox', {}, headers={'Origin': 'https://foreign.example'})[0] == 403, 'foreign Origin rejected')
        check(public.api('sandbox', {}, method='GET')[2].get('Allow') == 'POST', 'known wrong method returns Allow before runtime')
        check(public.api('unknown', {})[0] == 404 and untouched(), 'unknown route performs no runtime access')
        for raw, expected in [(b'[]', 400), (b'null', 400), (b'{', 400), (b'{"field":"\\ud800"}', 400), (b'\xff', 400), (b' ' * 16385, 413)]:
            check(public.api('sandbox', raw)[0] == expected and untouched(), 'malformed or oversized body rejected before lock')
        check(public.api('sandbox', {}, headers={'Content-Type': 'text/plain'})[0] == 415 and untouched(), 'non-JSON content type rejected before lock')
        first = Client(origin)
        initial, cookie_headers = first.initialize()
        check(initial['created'] and initial['protocolVersion'] == 1 and initial['idleSeconds'] == 14400 and initial['pageSize'] == 20 and isinstance(initial['expiresAt'], int), 'php_contract_parity bootstrap')
        check(all('Path=/travel-agency-demo/' in value and 'HttpOnly' in value and 'SameSite=Strict' in value and 'Max-Age=14400' in value and 'Secure' not in value for value in cookie_headers.get_all('Set-Cookie')), 'HTTP edge cookie attributes')
        first.login()
        second = Client(origin); second.initialize(); second.login()
        check(first.context != second.context and first.cookie('elsewhere_sandbox_v1') != second.cookie('elsewhere_sandbox_v1'), 'independent cookie jars use separate contexts')
        valid = dict(firstName='Taylor', lastName='Demo', email='taylor@travel.example', destination='italy', journey='italian-slow-days', departure='', travelers=2, budget='', message='Hosting verification', consent=True)
        before = registry()
        for change in [dict(firstName=' '), dict(email='invalid'), dict(consent=False), dict(travelers=0), dict(travelers=13), dict(travelers='2'), dict(destination='bogus'), dict(departure='2099-02-30'), dict(message='界' * 2001), dict(firstName='界' * 61)]:
            check(first.api('enquiries', {**valid, **change})[0] == 400, 'input rejected: ' + next(iter(change)))
        check(registry() == before, 'validation failures have no activity')
        status, created, _ = first.api('enquiries', valid)
        check(status == 201 and created['id'] == 5 and created['reference'].startswith('EW-'), 'PHP creates typed enquiry')
        overview = first.api('admin/overview')[1]
        check(len(overview['enquiries']) == 5 and len(second.api('admin/overview')[1]['enquiries']) == 4, 'separate visitor records')
        check(len(overview['bookings']) == 3 and isinstance(overview['enquiries'][0]['travelers'], int), 'seed counts and numeric JSON fields')
        catalog = json.loads((private / 'catalog.json').read_text())
        check(overview['catalog'] == {'destinations': [{'id': entry['id'], 'name': entry['name']} for entry in catalog['destinations']], 'journeys': [{'id': entry['id'], 'title': entry['title']} for entry in catalog['journeys']]}, 'overview catalog exposes only destination id/name and journey id/title')
        check(overview['enquiries'][-1]['departure'] > time.strftime('%Y-%m-%d', time.gmtime()), 'relative seed departure remains future')
        check(first.api('admin/enquiries/5', {'status': 'contacted'}, 'PATCH')[0] == 200, 'status update persists')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            conversion_results = list(pool.map(lambda _: Client(origin).api('admin/enquiries/5/booking', {}, headers={'Cookie': 'elsewhere_sandbox_v1=' + first.cookie('elsewhere_sandbox_v1') + '; elsewhere_dashboard_v1=' + first.cookie('elsewhere_dashboard_v1'), 'X-Elsewhere-Context': first.context}), range(2)))
        check(sorted(result[0] for result in conversion_results) == [201, 409] and next(result for result in conversion_results if result[0] == 409)[1]['code'] == 'conflict', 'php_parallel_admission_and_conversion: one conversion wins')
        conflict = first.api('admin/enquiries/5/booking', {})
        check(len(conflict[2].get_all('Set-Cookie')) == 2 and all('Path=/travel-agency-demo/' in value for value in conflict[2].get_all('Set-Cookie')), 'admitted business errors renew hosted cookies')
        overview = first.api('admin/overview')[1]
        check(len(overview['bookings']) == 4 and overview['bookings'][0]['value'] == 6500 and overview['enquiries'][0]['status'] == 'converted', 'conversion atomic and value correct')
        check(first.api('admin/enquiries/5', {'status': 'new'}, 'PATCH')[1]['code'] == 'conflict', 'converted enquiry cannot reopen')
        stale = first.api('enquiries', valid, headers={'X-Elsewhere-Context': second.context})
        check(stale[0] == 409 and stale[1]['code'] == 'sandbox_context' and not stale[2].get_all('Set-Cookie'), 'stale context has no write or renewal')
        old = Client(origin)
        old.context = first.context
        check(old.api('admin/overview', headers={'Cookie': 'elsewhere_travel_demo=legacy; PHPSESSID=legacy'})[1]['code'] == 'sandbox_context', 'legacy cookies authorize nothing')
        duplicate = first.api('sandbox', {}, headers={'Cookie': 'elsewhere_sandbox_v1=' + first.cookie('elsewhere_sandbox_v1') + '; elsewhere_sandbox_v1=' + second.cookie('elsewhere_sandbox_v1')})
        check(duplicate[0] == 400, 'duplicate identity cookie rejected')
        for path in ['registry.sqlite', 'registry.sqlite-journal', database(first).name, database(first).name + '-journal']:
            check(public.request('/travel-agency-demo/private/' + runtime_root.name + '/' + path)[0] == 403, 'live private file denied: ' + path)
        check(first.api('admin/logout', {})[0] == 200 and first.api('admin/overview')[1]['code'] == 'dashboard_access', 'logout revokes dashboard')
        first.login()
        check(len(first.api('admin/overview')[1]['enquiries']) == 5, 'logout preserves edits')
        check((legacy / 'demo.sqlite').read_bytes() == b'LEGACY SQLITE SENTINEL' and (legacy / 'session-old').read_bytes() == b'LEGACY SESSION SENTINEL', 'legacy sentinels unchanged')

        configure('aborted')
        partial = socket.create_connection(('127.0.0.1', port), timeout=5)
        try:
            partial.sendall(('POST /travel-agency-demo/api.php?route=sandbox HTTP/1.1\r\nHost: 127.0.0.1:' + str(port) + '\r\nOrigin: ' + origin + '\r\nContent-Type: application/json\r\nContent-Length: 10000\r\n\r\n{').encode())
            started = time.monotonic()
            independent = Client(origin); independent.initialize()
            check(time.monotonic() - started < 1.5, 'partial body holds no registry transaction')
        finally:
            partial.close()
        time.sleep(.1)
        check(len(registry()['sandboxes']) == 1, 'aborted body allocates no partial sandbox')

        configure('parallel', {'maxSandboxes': 2, 'maxDatabaseBytes': 32768})
        def allocate(_):
            visitor = Client(origin)
            return visitor, visitor.api('sandbox', {})
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            admissions = list(pool.map(allocate, range(8)))
        check(sum(result[0] == 200 for _, result in admissions) == 2 and all(result[0] in [200, 503] for _, result in admissions), 'parallel PHP processes respect slot cap')
        check(len(registry()['sandboxes']) == 2 and all(result[1]['code'] == 'capacity' for _, result in admissions if result[0] != 200), 'parallel allocation state is complete and charged')
        check(all(database(visitor).stat().st_size <= 32768 for visitor, result in admissions if result[0] == 200) and len(list(runtime_root.glob('*.sqlite'))) == 3, 'parallel allocation database byte cap and file count')

        configure('rates', {'allocationLimit': 1})
        visitor = Client(origin); visitor.initialize()
        before = registry()
        denied = Client(origin).api('sandbox', {}, headers={'X-Forwarded-For': '192.0.2.99', 'Forwarded': 'for=192.0.2.99'})
        check(denied[0] == 429 and denied[1]['code'] == 'rate_limited' and int(denied[2]['Retry-After']) > 0, 'forged forwarding headers cannot evade shared-IP allocation limit')
        check(registry() == before, 'rate rejection does not renew activity')

        configure('busy')
        holder = php_worker(f"""$database=new PDO('sqlite:'.{php_string(runtime_root / 'registry.sqlite')});$database->exec(file_get_contents({php_string(private / 'registry-schema.sql')}));$database->exec('BEGIN IMMEDIATE');echo "READY\\n";flush();sleep(3);""")
        try:
            wait_output(holder)
            started = time.monotonic()
            busy = Client(origin).api('sandbox', {})
            check(busy[0] == 503 and busy[1]['code'] == 'busy' and busy[2]['Retry-After'] == '2' and 1.8 <= time.monotonic() - started < 4, 'live process lock wait is bounded')
        finally:
            if holder.poll() is None:
                holder.kill(); holder.wait(timeout=5)
        recovered = Client(origin); recovered.initialize()
        check(len(registry()['sandboxes']) == 1, 'php_lock_released_after_process_death')

        configure('quota', {'maxDatabaseBytes': 32768, 'enquiryLimit': 100})
        visitor = Client(origin); visitor.initialize(); visitor.login()
        for index in range(96):
            response = visitor.api('enquiries', {**valid, 'message': '界' * 2000})
            if response[0] != 201:
                check(response[0] == 409 and response[1]['code'] == 'sandbox_full', 'multibyte storage exhaustion maps sandbox_full')
                break
        else:
            raise AssertionError('quota was never reached')
        check(database(visitor).stat().st_size <= 32768, 'SQLite main file cap enforced')
        prior = visitor.api('admin/overview')[1]
        database_file = database(visitor)
        database_mode = database_file.stat().st_mode
        database_file.chmod(0o400)
        try:
            failed = visitor.api('admin/enquiries/1/booking', {})
            check(failed[0] == 503 and failed[1]['code'] == 'unavailable' and 'Permission' not in json.dumps(failed[1]) and 'readonly' not in json.dumps(failed[1]), 'arbitrary SQLite IO failure is private unavailable')
        finally:
            database_file.chmod(database_mode)
        after = visitor.api('admin/overview')[1]
        check(after['bookings'] == prior['bookings'] and after['enquiries'] == prior['enquiries'], 'failed conversion creates no partial booking or status')

        configure('hot')
        visitor = Client(origin); visitor.initialize(); visitor.login()
        created = visitor.api('enquiries', valid)[1]
        path = database(visitor)
        hot_worker = php_worker(f"""$database=new PDO('sqlite:'.{php_string(path)});$database->exec("PRAGMA cache_size=1; PRAGMA cache_spill=ON; BEGIN IMMEDIATE; UPDATE enquiries SET message=printf('%02000d',7)");echo "READY\\n";flush();sleep(30);""")
        try:
            wait_output(hot_worker)
            hot_worker.kill(); hot_worker.wait(timeout=5)
            check(Path(str(path) + '-journal').stat().st_size > 0, 'hot journal fixture produced by killed SQLite writer')
            overview = visitor.api('admin/overview')
            check(overview[0] == 200 and len(overview[1]['enquiries']) == 5 and overview[1]['enquiries'][0]['reference'] == created['reference'] and overview[1]['enquiries'][0]['message'] == valid['message'], 'hot journal restart preserves committed work without reseeding')
        finally:
            if hot_worker.poll() is None:
                hot_worker.kill(); hot_worker.wait(timeout=5)

        unavailable = {'error': 'The demo storage is unavailable.', 'code': 'unavailable'}
        configure('missing', create=False)
        offset = log_offset()
        missing = Client(origin).api('sandbox', {})
        check(missing[0] == 503 and missing[1] == unavailable and not runtime_root.exists(), 'missing sandboxes folder returns unavailable')
        logged = logged_since(offset)
        check('API storage failed' in logged and 'unable to open database file' in logged, 'missing sandboxes folder logs its own cause')

        sandboxes = private / 'sandboxes'
        set_aside = private / 'sandboxes-set-aside'
        sandboxes.rename(set_aside)
        try:
            configure('unextracted', create=False, root=sandboxes)
            sapi_offsets = [log_offset(temp / 'error.log'), log_offset(fpm_log)]
            unextracted = Client(origin).api('sandbox', {})
            check(unextracted[0] == 503 and unextracted[1] == unavailable and not sandboxes.exists(), 'unextracted private sandboxes folder returns unavailable and is not recreated')
            sapi_logged = logged_since(sapi_offsets[0], temp / 'error.log') + logged_since(sapi_offsets[1], fpm_log)
            check('API storage failed' in sapi_logged and 'unable to open database file' in sapi_logged, 'missing log folder falls back to the SAPI log with the cause')
        finally:
            set_aside.rename(sandboxes)

        configure('relative-root', create=False, root=Path('relative/sandboxes'))
        offset = log_offset()
        relative = Client(origin).api('sandbox', {})
        logged = logged_since(offset)
        check(relative[0] == 503 and relative[1] == unavailable and 'API initialization failed' in logged and 'Explicit absolute runtime root required.' in logged, 'relative sandbox_root fails loudly at initialization')

        configure('corrupt')
        (runtime_root / 'registry.sqlite').write_bytes(b'not a database')
        offset = log_offset()
        corrupt_status, corrupt_raw, _ = Client(origin).request('/travel-agency-demo/api.php?route=sandbox', {}, headers={'Origin': origin})
        check(corrupt_status == 503 and json.loads(corrupt_raw) == unavailable and b'registry.sqlite' not in corrupt_raw and str(temp).encode() not in corrupt_raw, 'corrupt_registry_is_unavailable')
        check((runtime_root / 'registry.sqlite').read_bytes() == b'not a database', 'corrupt registry is left untouched')
        logged = logged_since(offset)
        check('API storage failed' in logged and 'file is not a database' in logged, 'corrupt registry logs its own cause')

        configure('seed-failure')
        schema = private / 'schema.sql'
        schema_bytes = schema.read_bytes()
        schema.write_text('CREATE TABLE broken (;')
        offset = log_offset()
        try:
            seed_failure = Client(origin).api('sandbox', {})
        finally:
            schema.write_bytes(schema_bytes)
        check(seed_failure[0] == 503 and seed_failure[1]['code'] == 'unavailable', 'bootstrap seed failure is unavailable')
        check(registry() == {'sandboxes': {}, 'rateBuckets': {}} and sorted(entry.name for entry in runtime_root.iterdir()) == ['registry.sqlite'], 'bootstrap seed failure leaves nothing: no row, no charge, no partial file')
        logged = logged_since(offset)
        check(error_log.is_file() and 'API storage failed' in logged and 'syntax error' in logged, 'error log written to private sandboxes folder with the seed failure cause')
        check(public.request('/travel-agency-demo/private/sandboxes/php-errors.log')[0] == 403, 'error log denied over HTTP')

        configure('missing-file')
        visitor = Client(origin); visitor.initialize(); visitor.login()
        path = database(visitor)
        path.unlink()
        missing_file = visitor.api('admin/overview')
        check(missing_file[0] == 503 and missing_file[1]['code'] == 'unavailable' and not path.exists(), 'missing_visitor_file_is_unavailable_and_not_recreated')
        missing_write = visitor.api('enquiries', valid)
        check(missing_write[0] == 503 and missing_write[1]['code'] == 'unavailable' and not path.exists() and not Path(str(path) + '-journal').exists(), 'write to a missing visitor file never recreates it')

        configure('cleanup-failure')
        expired = Client(origin); expired.initialize()
        expired_path = database(expired)
        expired_path.unlink()
        expired_path.mkdir()
        (expired_path / 'occupant').write_text('FICTIONAL ORPHAN SENTINEL')
        aged = registry()
        aged['sandboxes'][expired_path.stem]['lastActivity'] = int(time.time()) - 14401
        save_registry(aged)
        offset = log_offset()
        survivor = Client(origin); survivor.initialize()
        remaining = registry()['sandboxes']
        check(list(remaining) == [database(survivor).stem] and 'Sandbox cleanup failed' in logged_since(offset) and expired_path.is_dir(), 'failed_file_delete_is_logged_and_row_removed')
        reattached = expired.api('enquiries', valid)
        check(reattached[0] == 409 and reattached[1]['code'] == 'sandbox_context', 'orphaned visitor file is never reattached')

        configure('secure', external_origin='https://deployment.example')
        secure = Client(origin)
        status, initial, headers = secure.api('sandbox', {}, headers={'Origin': 'https://deployment.example', 'Host': 'forged.example', 'X-Forwarded-Proto': 'http'})
        check(status == 200 and all('; Secure' in value and 'Path=/travel-agency-demo/' in value for value in headers.get_all('Set-Cookie')), 'HTTPS configured origin controls Secure independently of request headers')
        check((legacy / 'demo.sqlite').read_bytes() == b'LEGACY SQLITE SENTINEL', 'failure/concurrency phases preserve legacy data')
        log_lines = [line for log in [temp / 'error.log', fpm_log, error_log, router_log_path, local_sandboxes / 'php-errors.log'] if log.exists() for line in log.read_text().splitlines()]
        check(not any('stale class loaded' in line for line in log_lines), 'stale class sentinels never loaded')
        warning_lines = [line for line in log_lines if ('PHP Fatal' in line or 'PHP Warning' in line) and 'JIT is incompatible' not in line]
        check(not warning_lines, 'no PHP runtime warnings or fatals: ' + '\n'.join(warning_lines))
    finally:
        stop(apache)
        stop(fpm)
        process_log.close()
        for directory, subdirectories, _ in os.walk(temp):
            Path(directory).chmod(0o700)
print(f'{checks} InfinityFree hosting checks passed.')
