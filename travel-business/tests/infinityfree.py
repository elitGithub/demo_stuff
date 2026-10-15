#!/usr/bin/env python3
"""Exercise the actual shared-hosting package under isolated Apache and PHP."""
import http.cookiejar
import json
from pathlib import Path
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


with tempfile.TemporaryDirectory(prefix='travel-infinityfree-') as temporary:
    temp = Path(temporary)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    package = temp / 'travel-demo'
    subprocess.run(['node', '--disable-warning=ExperimentalWarning', 'bin/package-infinityfree.mjs', '--output', str(package), '--origin', origin], cwd=ROOT, check=True)
    with zipfile.ZipFile(package / 'travel-demo.zip') as archive:
        files = archive.namelist()
        check(all(name == 'index.html' or name.startswith('travel-agency-demo/') for name in files), 'archive changes only the new travel subsite and root index')
        check(not any(name.endswith(('.sqlite', '.zip', '.log', '.mjs')) or '/runtime/' in name for name in files), 'archive excludes runtime databases, source tooling and logs')
        archive.extractall(temp / 'web')
    web = temp / 'web'
    modules = Path('/usr/lib/apache2/modules')
    php_module = sorted(modules.glob('libphp*.so'))[-1]
    config = temp / 'apache.conf'
    config.write_text(f'''ServerRoot "{temp}"
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
TypesConfig /etc/mime.types
ErrorLog "{temp}/error.log"
LogLevel warn
DocumentRoot "{web}"
<Directory "{web}">
    Options FollowSymLinks
    AllowOverride AuthConfig FileInfo Indexes Options=Indexes
    Require all granted
    php_admin_value disable_functions putenv
</Directory>
<FilesMatch "\\.php$">
    SetHandler application/x-httpd-php
</FilesMatch>
''')
    jar = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def request(path, data=None, method=None, headers=None):
        request_headers = headers or {}
        if data is not None:
            request_headers = {'Content-Type': 'application/json', **request_headers}
        req = urllib.request.Request(origin + path, data=None if data is None else json.dumps(data).encode(), headers=request_headers, method=method)
        try:
            response = client.open(req, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        return response.status, response.read(), response.headers

    def api(route, data=None, method=None, headers=None):
        status, raw, response_headers = request('/travel-agency-demo/api.php?route=' + urllib.parse.quote(route, safe=''), data, method, headers)
        try:
            result = json.loads(raw)
        except ValueError:
            raise AssertionError(f'Non-JSON API response {status}: {raw[:500]!r}')
        return status, result, response_headers

    log = (temp / 'process.log').open('w')
    apache = subprocess.Popen(['apache2', '-f', str(config), '-DFOREGROUND'], stdout=log, stderr=log, start_new_session=True)
    try:
        for attempt in range(50):
            try:
                request('/')
                break
            except (urllib.error.URLError, ConnectionError):
                if apache.poll() is not None:
                    raise AssertionError((temp / 'error.log').read_text() if (temp / 'error.log').exists() else (temp / 'process.log').read_text())
                time.sleep(.1)
        status, raw, _ = request('/')
        check(status == 200 and b'href="/studio/"' in raw and b'href="/travel-agency-demo/"' in raw, 'plain root index links to both demos')
        for page in ['', 'destinations.html', 'journeys.html', 'about.html', 'journal.html', 'contact.html', 'admin.html']:
            status, raw, headers = request('/travel-agency-demo/' + page)
            check(status == 200 and b'name="api-endpoint" content="api.php"' in raw, 'subdirectory page and PHP endpoint configuration: ' + (page or 'home'))
            check("script-src 'self'" in headers.get('Content-Security-Policy', ''), 'CSP applied: ' + (page or 'home'))
        for path in ['assets/styles.css', 'assets/app.js', 'assets/admin.js', 'assets/fonts/dm-serif.ttf', 'assets/images/hero-lake.jpg']:
            check(request('/travel-agency-demo/' + path)[0] == 200, 'asset is served: ' + path)
        for path in ['private/', 'private/config.php', 'private/seed.json', 'private/schema.sql', 'private/api.php', '.htaccess']:
            check(request('/travel-agency-demo/' + path)[0] == 403, 'private file denied: ' + path)
        check(api('admin/overview')[0] == 401, 'dashboard records require demo session')
        valid = dict(firstName='Taylor', lastName='Demo', email='taylor@example.com', destination='italy', journey='italian-slow-days', departure='', travelers=2, budget='', message='Hosting verification', consent=True)
        check(api('enquiries', valid, headers={'Origin': 'https://other.example'})[0] == 403, 'cross-origin form submission is rejected')
        for change in [dict(firstName=' '), dict(email='invalid'), dict(consent=False), dict(travelers=0), dict(travelers=13), dict(travelers='2'), dict(destination='bali'), dict(departure='2099-02-30'), dict(message='a' * 2001)]:
            check(api('enquiries', {**valid, **change})[0] == 400, 'invalid submission rejected: ' + next(iter(change)))
        status, created, _ = api('enquiries', valid, headers={'Origin': origin})
        check(status == 201 and created['reference'].startswith('EW-'), 'PHP saves a new enquiry')
        check(api('admin/login', {})[0] == 200, 'public demo login works')
        check(any(cookie.name == 'elsewhere_travel_demo' and cookie.path == '/travel-agency-demo/' and cookie.has_nonstandard_attr('HttpOnly') for cookie in jar), 'session cookie is HttpOnly and scoped to this subsite')
        status, overview, _ = api('admin/overview')
        check(status == 200 and len(overview['enquiries']) == 5, 'seed records and submitted enquiry are returned')
        check(isinstance(overview['enquiries'][0]['id'], int) and isinstance(overview['enquiries'][0]['travelers'], int), 'record numeric fields preserve JSON types')
        identifier = created['id']
        check(api(f'admin/enquiries/{identifier}', dict(status='contacted'), 'PATCH')[0] == 200, 'PHP supports dashboard status updates')
        check(api('admin/overview')[1]['enquiries'][0]['status'] == 'contacted', 'status persists between PHP requests')
        check(api(f'admin/enquiries/{identifier}/booking', {})[0] == 201, 'enquiry becomes a sample booking')
        check(api(f'admin/enquiries/{identifier}/booking', {})[0] == 409, 'duplicate conversion is blocked')
        booking = api('admin/overview')[1]['bookings'][0]
        check(booking['value'] == 6500 and booking['status'] == 'planning', 'sample booking value and status are correct')
        check(api(f'admin/enquiries/{identifier}', dict(status='new'), 'PATCH')[0] == 409, 'converted enquiry cannot be reopened')
        check(request('/travel-agency-demo/private/runtime/demo.sqlite')[0] == 403, 'live SQLite database is not downloadable')
        check(api('admin/logout', {})[0] == 200 and api('admin/overview')[0] == 401, 'logout revokes access')
        errors = (temp / 'error.log').read_text()
        # The workstation's PHP/Xdebug combination disables JIT at startup;
        # this is unrelated to requests handled by the deployment package.
        startup_jit_warning = 'PHP Warning:  JIT is incompatible with third party extensions that override zend_execute_ex(). JIT disabled. in Unknown on line 0'
        php_errors = '\n'.join(line for line in errors.splitlines() if ('PHP Fatal' in line or 'PHP Warning' in line) and line != startup_jit_warning)
        check(not php_errors, 'PHP completes without runtime warnings' + (': ' + php_errors if php_errors else ''))
    finally:
        apache.terminate()
        try:
            apache.wait(timeout=10)
        except subprocess.TimeoutExpired:
            apache.kill()
            apache.wait()
        log.close()
print(f'{checks} InfinityFree hosting checks passed.')
