#!/usr/bin/env python3
"""Exercise generated fixture packages with real parallel Apache and PHP-FPM workers."""
import concurrent.futures
import contextlib
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import select
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
    subprocess.run(['node', 'bin/package-infinityfree.mjs', '--output', str(package), '--origin', origin], cwd=ROOT, check=True)
    web = temp / 'web'
    web.mkdir()
    (web / 'index.html').write_text('ROOT HUB SENTINEL')
    stale_classes = web / 'travel-agency-demo/private/classes'
    stale_classes.mkdir(parents=True)
    stale_names = ['Registry.php', 'RateBucket.php', 'SandboxState.php']
    for name in stale_names:
        (stale_classes / name).write_text("<?php throw new Error('stale class loaded');")
    with zipfile.ZipFile(package / 'travel-demo.zip') as archive:
        files = archive.namelist()
        check(all(name.startswith('travel-agency-demo/') for name in files), 'package_is_only_elsewhere')
        check(not any(name.endswith(('.sqlite', '.db', '.zip', '.log', '.mjs')) or 'runtime' in name for name in files), 'package excludes runtime and test state')
        check('travel-agency-demo/private/sandboxes/.htaccess' in files and 'travel-agency-demo/private/registry-schema.sql' in files, 'package ships the sandboxes folder guard and registry schema')
        archive.extractall(web)
    private = web / 'travel-agency-demo/private'
    check(all((stale_classes / name).read_text() == "<?php throw new Error('stale class loaded');" for name in stale_names), 'stale 2026-10-18 class sentinels survive the overwrite extract')
    check((private / 'sandboxes').is_dir() and (private / 'sandboxes/.htaccess').read_text() == 'Require all denied\n', 'extraction creates the private sandboxes folder')
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
        for page in ['', 'destinations.html', 'journeys.html', 'about.html', 'journal.html', 'contact.html', 'admin.html']:
            status, raw, headers = public.request('/travel-agency-demo/' + page)
            check(status == 200 and b'name="api-endpoint" content="api.php"' in raw, 'nested endpoint: ' + (page or 'home'))
            check("script-src 'self'" in headers.get('Content-Security-Policy', ''), 'CSP: ' + (page or 'home'))
        for path in ['assets/styles.css', 'assets/sandbox.js', 'assets/dashboard-pagination.js', 'assets/app.js', 'assets/admin.js', 'assets/fonts/dm-serif.ttf', 'assets/images/hero-lake.jpg']:
            check(public.request('/travel-agency-demo/' + path)[0] == 200, 'asset: ' + path)
        for path in ['private/', 'private/config.php', 'private/demo-seed.json', 'private/sandbox.json', 'private/schema.sql', 'private/registry-schema.sql', 'private/api.php', 'private/classes/SandboxRuntime.php', 'private/runtime/demo.sqlite', 'private/sandboxes/', 'private/sandboxes/.htaccess', '.htaccess']:
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
        check(initial['created'] and initial['protocolVersion'] == 1 and initial['idleSeconds'] == 14400 and initial['pageSize'] == 20 and isinstance(initial['expiresAt'], int), 'php_node_contract_parity bootstrap')
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
            check(time.monotonic() - started < 1.5, 'partial body holds no runtime lock')
        finally:
            partial.close()
        time.sleep(.1)
        check(len(registry()['sandboxes']) == 1, 'aborted body allocates no partial sandbox')

        parallel_bytes = 2097152 + 6 * 32768
        configure('parallel', {'maxSandboxes': 2, 'maxDatabaseBytes': 32768, 'journalReserveBytes': 65536, 'stagingReserveBytes': 65536, 'maxRuntimeBytes': parallel_bytes})
        def allocate(_):
            visitor = Client(origin)
            return visitor, visitor.api('sandbox', {})
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            admissions = list(pool.map(allocate, range(8)))
        check(sum(result[0] == 200 for _, result in admissions) == 2 and all(result[0] in [200, 503] for _, result in admissions), 'parallel PHP processes respect slot cap')
        check(len(registry()['sandboxes']) == 2 and all(result[1]['code'] == 'capacity' for _, result in admissions if result[0] != 200), 'parallel allocation state is complete and charged')
        check(all(database(visitor).stat().st_size <= 32768 for visitor, result in admissions if result[0] == 200) and sum(path.stat().st_size for path in runtime_root.rglob('*') if path.is_file()) <= parallel_bytes, 'parallel allocation database and total managed byte caps')

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
        log_lines = [line for log in [temp / 'error.log', fpm_log, error_log] if log.exists() for line in log.read_text().splitlines()]
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
