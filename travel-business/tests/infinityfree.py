#!/usr/bin/env python3
"""Exercise generated fixture packages with real parallel Apache/PHP workers."""
import concurrent.futures
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import select
import secrets
import signal
import socket
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
    with zipfile.ZipFile(package / 'travel-demo.zip') as archive:
        files = archive.namelist()
        check(all(name.startswith('travel-agency-demo/') for name in files), 'package_is_only_elsewhere')
        check(not any(name.endswith(('.sqlite', '.db', '.zip', '.log', '.mjs')) or 'runtime' in name or 'preflight' in name for name in files), 'package excludes runtime/test/preflight state')
        archive.extractall(web)
    private = web / 'travel-agency-demo/private'
    legacy = private / 'runtime'
    legacy.mkdir()
    (legacy / 'demo.sqlite').write_bytes(b'LEGACY SQLITE SENTINEL')
    (legacy / 'session-old').write_bytes(b'LEGACY SESSION SENTINEL')
    runtime_root = None

    def configure(name, overrides=None, external_origin=None):
        global runtime_root
        runtime_root = private / ('fixture-' + name)
        values = {} if overrides is None else overrides
        config_text = "<?php\nreturn ['origin' => " + php_string(external_origin or origin) + ", 'base_path' => '/travel-agency-demo', 'sandbox_root' => " + php_string(runtime_root) + ", 'sandbox' => json_decode(" + php_string(json.dumps(values)) + ")];\n"
        (private / 'config.php').write_text(config_text)
        return runtime_root

    def registry():
        return json.loads((runtime_root / 'registry.json').read_text())

    def save_registry(value):
        (runtime_root / 'registry.json').write_text(json.dumps(value, separators=(',', ':')))

    def database(client):
        return runtime_root / hashlib.sha256(client.cookie('elsewhere_sandbox_v1').encode()).hexdigest() / 'demo.sqlite'

    def php_worker(code):
        return subprocess.Popen(['php', '-r', code], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    configure('main')
    modules = Path('/usr/lib/apache2/modules')
    php_module = sorted(modules.glob('libphp*.so'))[-1]
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
LoadModule php_module {php_module}
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
    php_admin_value disable_functions putenv
    php_admin_flag display_errors Off
    php_admin_flag opcache.enable Off
</Directory>
<FilesMatch "\\.php$">
    SetHandler application/x-httpd-php
</FilesMatch>
''')
    apache_log = (temp / 'process.log').open('w')
    apache = subprocess.Popen(['apache2', '-f', str(apache_config), '-DFOREGROUND'], stdout=apache_log, stderr=apache_log, start_new_session=True)
    try:
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
        diagnostic = '/travel-agency-demo/preflight.php'
        (web / 'travel-agency-demo/preflight.php').write_bytes(b"<?php ini_set('display_errors', '1'); ?>" + (ROOT / 'deploy/infinityfree/preflight.php').read_bytes())
        fixture = private / 'runtime/preflight-v1'
        token = secrets.token_hex(32)
        authorization = {'X-Elsewhere-Preflight': token}
        check(public.request(diagnostic, {'action': 'check'}, headers=authorization)[0] == 403 and not fixture.exists(), 'preflight missing secret fails before fixture work')
        secret_file = private / 'preflight-secret.php'
        secret_file.write_text('<?php return ' + php_string(hashlib.sha256(token.encode()).hexdigest()) + ';\n')
        for headers in [{}, {'X-Elsewhere-Preflight': '0' * 64}]:
            check(public.request(diagnostic, {'action': 'check'}, headers=headers)[0] == 403 and not fixture.exists(), 'preflight missing or wrong token performs no fixture work')
        check(public.request('/travel-agency-demo/private/preflight-secret.php')[0] == 403, 'preflight secret protected by Apache')
        rejected = public.request(diagnostic, method='GET', headers=authorization)
        check(rejected[0] == 405 and rejected[2].get('Allow') == 'POST' and not fixture.exists(), 'preflight accepts only authorized POST')
        for body, expected, extra in [(b'[]', 400, {}), (b'{', 400, {}), ({'action': 'unknown'}, 400, {}), ({'action': 'check', 'extra': True}, 400, {}), (b' ' * 1025, 413, {}), ({'action': 'check'}, 415, {'Content-Type': 'text/plain'})]:
            check(public.request(diagnostic, body, headers={**authorization, **extra})[0] == expected and not fixture.exists(), 'preflight rejects invalid input before fixture work')
        checked = public.request(diagnostic, {'action': 'check'}, headers=authorization)
        check(checked[0] == 200 and json.loads(checked[1]) == {'acquired': True, 'pdoSqlite': True, 'privateWritable': True, 'atomicReplace': True} and checked[2].get('Cache-Control') == 'no-store', 'preflight reports actual SQLite capability and atomic marker verification')
        previous_marker = (fixture / 'marker.json').read_bytes()
        check(public.request(diagnostic, {'action': 'check'}, headers=authorization)[0] == 200 and (fixture / 'marker.json').read_bytes() != previous_marker and not (fixture / 'marker.tmp').exists(), 'preflight atomically replaces an existing bounded marker')
        fixture.chmod(0o500)
        try:
            failed_preflight = public.request(diagnostic, {'action': 'check'}, headers=authorization)
            check(failed_preflight[0] == 503 and json.loads(failed_preflight[1]) == {'error': 'Preflight fixture unavailable.'} and str(temp).encode() not in failed_preflight[1], 'preflight storage failure stays generic even with host display_errors enabled')
        finally:
            fixture.chmod(0o700)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            started = time.monotonic()
            hold = pool.submit(lambda: Client(origin).request(diagnostic, {'action': 'hold'}, headers=authorization))
            for attempt in range(30):
                probe = public.request(diagnostic, {'action': 'probe'}, headers=authorization)
                if json.loads(probe[1]).get('acquired') is False:
                    break
                time.sleep(.02)
            check(probe[0] == 200 and json.loads(probe[1]) == {'acquired': False}, 'concurrent Apache request cannot acquire held preflight lock')
            check(public.request(diagnostic, {'action': 'finish'}, headers=authorization)[0] == 409 and (fixture / 'marker.json').exists(), 'preflight finish never removes fixtures while lock held')
            held = hold.result(timeout=6)
            check(held[0] == 200 and json.loads(held[1]) == {'acquired': True, 'heldMilliseconds': 3000} and 2.8 <= time.monotonic() - started < 5, 'preflight lock hold bounded to three seconds')
        check(json.loads(public.request(diagnostic, {'action': 'probe'}, headers=authorization)[1]) == {'acquired': True}, 'later Apache request acquires released preflight lock')
        sentinel = fixture / 'unrelated-sentinel'
        sentinel.write_text('DO NOT REMOVE')
        check(json.loads(public.request(diagnostic, {'action': 'finish'}, headers=authorization)[1]) == {'acquired': True, 'finished': True} and not (fixture / 'marker.json').exists() and sentinel.read_text() == 'DO NOT REMOVE' and (fixture / 'fixture.lock').is_file(), 'finish removes only known marker files and retains persistent lock inode')
        check(not runtime_root.exists() and (legacy / 'demo.sqlite').read_bytes() == b'LEGACY SQLITE SENTINEL', 'standalone preflight never initializes app runtime or opens legacy database')
        for page in ['', 'destinations.html', 'journeys.html', 'about.html', 'journal.html', 'contact.html', 'admin.html']:
            status, raw, headers = public.request('/travel-agency-demo/' + page)
            check(status == 200 and b'name="api-endpoint" content="api.php"' in raw, 'nested endpoint: ' + (page or 'home'))
            check("script-src 'self'" in headers.get('Content-Security-Policy', ''), 'CSP: ' + (page or 'home'))
        for path in ['assets/styles.css', 'assets/sandbox.js', 'assets/dashboard-pagination.js', 'assets/app.js', 'assets/admin.js', 'assets/fonts/dm-serif.ttf', 'assets/images/hero-lake.jpg']:
            check(public.request('/travel-agency-demo/' + path)[0] == 200, 'asset: ' + path)
        for path in ['private/', 'private/config.php', 'private/demo-seed.json', 'private/sandbox.json', 'private/schema.sql', 'private/api.php', 'private/classes/SandboxRuntime.php', 'private/runtime/demo.sqlite', '.htaccess']:
            check(public.request('/travel-agency-demo/' + path)[0] == 403, 'private denial: ' + path)
        check(public.api('admin/overview')[1]['code'] == 'sandbox_context', 'missing generation precedes dashboard authorization')
        check(public.api('sandbox', {}, origin=False)[0] == 403, 'missing Origin rejected')
        check(not runtime_root.exists(), 'rejected request performs no runtime access')
        check(public.api('sandbox', {}, headers={'Origin': 'https://foreign.example'})[0] == 403, 'foreign Origin rejected')
        check(public.api('sandbox', {}, method='GET')[2].get('Allow') == 'POST', 'known wrong method returns Allow before runtime')
        check(public.api('unknown', {})[0] == 404 and not runtime_root.exists(), 'unknown route performs no runtime access')
        for raw, expected in [(b'[]', 400), (b'null', 400), (b'{', 400), (b'{"field":"\\ud800"}', 400), (b'\xff', 400), (b' ' * 16385, 413)]:
            check(public.api('sandbox', raw)[0] == expected and not runtime_root.exists(), 'malformed or oversized body rejected before lock')
        check(public.api('sandbox', {}, headers={'Content-Type': 'text/plain'})[0] == 415 and not runtime_root.exists(), 'non-JSON content type rejected before lock')
        first = Client(origin)
        initial, cookie_headers = first.initialize()
        check(initial['created'] and initial['protocolVersion'] == 1 and initial['idleSeconds'] == 14400 and initial['pageSize'] == 20 and isinstance(initial['expiresAt'], int), 'php_node_contract_parity bootstrap')
        check(all('Path=/travel-agency-demo/' in value and 'HttpOnly' in value and 'SameSite=Strict' in value and 'Max-Age=14400' in value and 'Secure' not in value for value in cookie_headers.get_all('Set-Cookie')), 'HTTP edge cookie attributes')
        first.login()
        second = Client(origin); second.initialize(); second.login()
        check(first.context != second.context and first.cookie('elsewhere_sandbox_v1') != second.cookie('elsewhere_sandbox_v1'), 'independent cookie jars use separate contexts')
        valid = dict(firstName='Taylor', lastName='Demo', email='taylor@travel.example', destination='italy', journey='italian-slow-days', departure='', travelers=2, budget='', message='Hosting verification', consent=True)
        before = (runtime_root / 'registry.json').read_bytes()
        for change in [dict(firstName=' '), dict(email='invalid'), dict(consent=False), dict(travelers=0), dict(travelers=13), dict(travelers='2'), dict(destination='bogus'), dict(departure='2099-02-30'), dict(message='界' * 2001), dict(firstName='界' * 61)]:
            check(first.api('enquiries', {**valid, **change})[0] == 400, 'input rejected: ' + next(iter(change)))
        check((runtime_root / 'registry.json').read_bytes() == before, 'validation failures have no activity')
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
        for path in ['registry.json', 'runtime.lock', database(first).parent.name + '/demo.sqlite', database(first).parent.name + '/demo.sqlite-journal']:
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
        before = (runtime_root / 'registry.json').read_bytes()
        denied = Client(origin).api('sandbox', {}, headers={'X-Forwarded-For': '192.0.2.99', 'Forwarded': 'for=192.0.2.99'})
        check(denied[0] == 429 and denied[1]['code'] == 'rate_limited' and int(denied[2]['Retry-After']) > 0, 'forged forwarding headers cannot evade shared-IP allocation limit')
        check((runtime_root / 'registry.json').read_bytes() == before, 'rate rejection does not renew activity')

        configure('death', {'maxSandboxes': 1})
        bootstrap = f"""require {php_string(private / 'autoload.php')};
$config = Elsewhere\\SandboxConfig::from((object)['maxSandboxes'=>1]);
$raw=json_decode(file_get_contents({php_string(private / 'catalog.json')}));
$catalog=new Elsewhere\\Catalog(destinations:array_map(fn($entry)=>new Elsewhere\\CatalogDestination(id:$entry->id,name:$entry->name),$raw->destinations),journeys:array_map(fn($entry)=>new Elsewhere\\CatalogJourney(id:$entry->id,title:$entry->title,destination:$entry->destination,price:$entry->price),$raw->journeys),budgets:['']);
$count=0;
$clock=function()use(&$count){{ $count++; if($count===2){{echo "READY\\n";flush();sleep(30);}} return time(); }};
$runtime=new Elsewhere\\SandboxRuntime(root:{php_string(runtime_root)},config:$config,catalog:$catalog,now:$clock);
$runtime->execute(Elsewhere\\SandboxOperation::Bootstrap,new Elsewhere\\RequestIdentity(remoteAddress:'192.0.2.1'));"""
        worker = php_worker(bootstrap)
        try:
            wait_output(worker)
            started = time.monotonic()
            busy = Client(origin).api('sandbox', {})
            check(busy[0] == 503 and busy[1]['code'] == 'busy' and busy[2]['Retry-After'] == '2' and 1.8 <= time.monotonic() - started < 4, 'live process lock wait is bounded')
            pending = registry()
            check(len(pending['sandboxes']) == 1 and next(iter(pending['sandboxes'].values()))['state'] == 'pending', 'process-death pending reservation persisted')
            pending_path = runtime_root / next(iter(pending['sandboxes']))
            worker.kill(); worker.wait(timeout=5)
            pending_path.chmod(0o500)
            after_death = Client(origin).api('sandbox', {})
            check(after_death[0] == 503 and after_death[1]['code'] == 'capacity', 'php_lock_released_after_process_death with failed cleanup charged')
            check(next(iter(registry()['sandboxes'].values()))['state'] == 'failed' and any(pending_path.iterdir()), 'crash artifacts remain charged on denied removal')
            pending_path.chmod(0o700)
            recovered = Client(origin); recovered.initialize()
            check(len(registry()['sandboxes']) == 1 and not pending_path.exists(), 'pending reservation recovered after OS releases lock')
        finally:
            if worker.poll() is None:
                worker.kill(); worker.wait(timeout=5)
            if 'pending_path' in locals() and pending_path.exists():
                pending_path.chmod(0o700)

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
        directory = database(visitor).parent
        directory.chmod(0o500)
        try:
            failed = visitor.api('admin/enquiries/1/booking', {})
            check(failed[0] == 503 and failed[1]['code'] == 'unavailable' and 'Permission' not in json.dumps(failed[1]), 'arbitrary SQLite IO failure is private unavailable')
        finally:
            directory.chmod(0o700)
        after = visitor.api('admin/overview')[1]
        check(after['bookings'] == prior['bookings'] and after['enquiries'] == prior['enquiries'], 'failed conversion creates no partial booking or status')
        journal = Path(str(database(visitor)) + '-journal')
        journal.write_bytes(b'x' * 65536); journal.chmod(0o600)
        configure_text = (private / 'config.php').read_text()
        total = 2097152 + 2 * 65536 + 32768
        (private / 'config.php').write_text(configure_text.replace('"enquiryLimit": 100', '"enquiryLimit": 100, "maxSandboxes": 1, "journalReserveBytes": 65536, "stagingReserveBytes": 65536, "maxRuntimeBytes": ' + str(total)))
        leftover = visitor.api('sandbox', {})
        check(leftover[0] == 503 and leftover[1]['code'] == 'capacity', 'leftover journal counted before mutation admission')
        journal.unlink()

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

        configure('secure', external_origin='https://deployment.example')
        secure = Client(origin)
        status, initial, headers = secure.api('sandbox', {}, headers={'Origin': 'https://deployment.example', 'Host': 'forged.example', 'X-Forwarded-Proto': 'http'})
        check(status == 200 and all('; Secure' in value and 'Path=/travel-agency-demo/' in value for value in headers.get_all('Set-Cookie')), 'HTTPS configured origin controls Secure independently of request headers')
        check((legacy / 'demo.sqlite').read_bytes() == b'LEGACY SQLITE SENTINEL', 'failure/concurrency phases preserve legacy data')
        errors = (temp / 'error.log').read_text()
        warning_lines = [line for line in errors.splitlines() if ('PHP Fatal' in line or 'PHP Warning' in line) and 'JIT is incompatible' not in line]
        check(not warning_lines, 'no PHP runtime warnings or fatals: ' + '\n'.join(warning_lines))
    finally:
        apache.terminate()
        try:
            apache.wait(timeout=10)
        except subprocess.TimeoutExpired:
            apache.kill(); apache.wait()
        apache_log.close()
        for directory, subdirectories, _ in os.walk(temp):
            Path(directory).chmod(0o700)
print(f'{checks} InfinityFree hosting checks passed.')
