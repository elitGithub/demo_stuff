#!/usr/bin/env python3
"""Verify the generated upload, then exercise it on isolated MySQL and Apache HTTPS.
Requires PHP/pdo_sqlite/pdo_mysql/mbstring, MySQL server/client, Apache mod_php,
OpenSSL and Python 3. Does not connect to or modify an existing database/server.
"""
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
checks = 0

def check(value, message):
    global checks
    assert value, message
    checks += 1
    print('PASS', message, flush=True)

def run(args, **kwargs):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    assert result.returncode == 0, result.stderr or result.stdout
    return result.stdout

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

class Browser:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), urllib.request.HTTPSHandler(context=ssl._create_unverified_context()))
    def request(self, path, data=None):
        request = urllib.request.Request(self.base + path, data=None if data is None else urllib.parse.urlencode(data).encode())
        try:
            response = self.client.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        return response.status, response.read().decode(), response.headers
    def token(self, path='/login'):
        code, body, _ = self.request(path)
        assert code == 200, (code, body[:200])
        return re.search(r'name="_csrf" value="([a-f0-9]+)"', body).group(1)
    def login(self, account):
        return self.request('/login', dict(_csrf=self.token(), **account))

with tempfile.TemporaryDirectory(prefix='resto-infinity-') as directory:
    temp = Path(directory)
    package = temp/'package'
    builder = ROOT/'bin/package-infinityfree.py'
    check(builder.is_file(), 'reproducible InfinityFree package builder exists')
    run(['python3', str(builder), '--output', str(package)], cwd=ROOT)
    with zipfile.ZipFile(package/'resto-chef-upload.zip') as archive:
        names = archive.namelist()
        check(all(n.startswith('htdocs/') for n in names), 'upload archive contains only website files')
        check(not any(n.endswith(('.sql', '.sqlite', '.json')) or '/tests/' in n or '/bin/' in n or '/.git/' in n for n in names), 'database, passwords, tooling and Git metadata excluded from upload')
        archive.extractall(temp/'unpacked')
    check((package/'.gitignore').read_text() == '*\n', 'all generated files are ignored even with a custom output directory')
    web = temp/'unpacked/htdocs'
    check((web/'private/.htaccess').is_file() and (web/'.htaccess').is_file(), 'both private-directory protections included')
    accounts = json.loads((package/'demo-credentials.json').read_text())
    sql = (package/'demo.sql').read_text()
    check(all(a['password'] not in sql for a in accounts.values()), 'SQL contains password hashes, not plaintext passwords')
    for name in names:
        content = (temp/'unpacked'/name).read_bytes()
        check(not any(a['password'].encode() in content for a in accounts.values()), 'upload contains no demo password: '+name)
    check('DROP TABLE' not in sql.upper() and 'CREATE DATABASE' not in sql.upper(), 'import targets a new selected database without deleting existing tables')
    for line in (package/'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ')
        check(hashlib.sha256((package/name).read_bytes()).hexdigest() == digest, 'checksum matches '+name)
    old_hash = hashlib.sha256((package/'demo.sql').read_bytes()).hexdigest()
    repeat = subprocess.run(['python3', str(builder), '--output', str(package)], capture_output=True)
    check(repeat.returncode != 0 and hashlib.sha256((package/'demo.sql').read_bytes()).hexdigest() == old_hash, 'rebuild refuses to replace existing database and passwords')

    data = temp/'mysql'
    run(['mysqld', '--no-defaults', '--initialize-insecure', '--datadir='+str(data)])
    dbport, httpport, httpsport = port(), port(), port()
    dbsock = str(temp/'mysql.sock')
    mysql = ['mysql', '--no-defaults', '--protocol=socket', '--socket='+dbsock, '-u', 'root', '-N', '-B']
    processes = []
    try:
        with (temp/'mysql.log').open('w') as log:
            processes.append(subprocess.Popen(['mysqld', '--no-defaults', '--datadir='+str(data), '--socket='+dbsock, '--pid-file='+str(temp/'mysql.pid'), '--port='+str(dbport), '--bind-address=127.0.0.1', '--mysqlx=OFF', '--log-error='+str(temp/'mysql-error.log')], stdout=log, stderr=log, start_new_session=True))
        for _ in range(200):
            ready = subprocess.run(mysql+['-e', 'SELECT 1'], capture_output=True)
            if ready.returncode == 0: break
            time.sleep(.1)
        else: raise AssertionError((temp/'mysql-error.log').read_text())
        password = os.urandom(20).hex()
        run(mysql, input="CREATE DATABASE resto_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER 'resto_app'@'127.0.0.1' IDENTIFIED BY '"+password+"'; GRANT SELECT,INSERT,UPDATE,DELETE ON resto_demo.* TO 'resto_app'@'127.0.0.1';")
        run(mysql+['resto_demo'], input=sql)
        counts = run(mysql+['resto_demo', '-e', 'SELECT (SELECT COUNT(*) FROM users),(SELECT COUNT(*) FROM food),(SELECT COUNT(*) FROM orders);']).strip()
        check(counts == '2\t8\t12', 'SQL imports into real MySQL with 2 accounts, 8 dishes and 12 orders')
        check(run(mysql+['resto_demo', '-e', 'SELECT COUNT(*) FROM orders WHERE completed_at >= UNIX_TIMESTAMP() - 7*86400;']).strip() == '10', 'sample completed sales fall within the last week at import')
        duplicate = subprocess.run(mysql+['resto_demo'], input=sql, text=True, capture_output=True)
        check(duplicate.returncode != 0, 'repeat SQL import refuses an initialized database')
        environment = web/'private/.env'
        environment.write_text(environment.read_text().replace('REPLACE_WITH_MYSQL_HOST', '127.0.0.1').replace('DB_PORT=3306', 'DB_PORT='+str(dbport)).replace('REPLACE_WITH_DATABASE_NAME', 'resto_demo').replace('REPLACE_WITH_DATABASE_USER', 'resto_app').replace('REPLACE_WITH_DATABASE_PASSWORD', password))
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', str(temp/'key.pem'), '-out', str(temp/'cert.pem')])
        modules = Path('/usr/lib/apache2/modules')
        php_module = sorted(modules.glob('libphp*.so'))[-1]
        configuration = f"""ServerRoot \"{temp}\"
PidFile \"{temp}/apache.pid\"
ServerName localhost
Listen 127.0.0.1:{httpport}
Listen 127.0.0.1:{httpsport}
LoadModule mpm_prefork_module {modules}/mod_mpm_prefork.so
LoadModule authz_core_module {modules}/mod_authz_core.so
LoadModule dir_module {modules}/mod_dir.so
LoadModule mime_module {modules}/mod_mime.so
LoadModule rewrite_module {modules}/mod_rewrite.so
LoadModule ssl_module {modules}/mod_ssl.so
LoadModule php_module {php_module}
TypesConfig /etc/mime.types
ErrorLog \"{temp}/apache-error.log\"
LogLevel warn
DocumentRoot \"{web}\"
<Directory \"{web}\">
  AllowOverride AuthConfig FileInfo Indexes Options=Indexes
  php_admin_value disable_functions putenv
  Options FollowSymLinks
  Require all granted
</Directory>
<FilesMatch \"\\.php$\">
  SetHandler application/x-httpd-php
</FilesMatch>
<VirtualHost 127.0.0.1:{httpsport}>
  SSLEngine on
  SSLCertificateFile \"{temp}/cert.pem\"
  SSLCertificateKeyFile \"{temp}/key.pem\"
</VirtualHost>
"""
        config = temp/'httpd.conf'
        config.write_text(configuration)
        with (temp/'apache.log').open('w') as log:
            processes.append(subprocess.Popen(['apache2', '-f', str(config), '-DFOREGROUND'], stdout=log, stderr=log, start_new_session=True))
        browser = Browser(f'https://127.0.0.1:{httpsport}')
        for _ in range(50):
            try: browser.request('/'); break
            except (urllib.error.URLError, ConnectionError): time.sleep(.1)
        status, body, headers = browser.request('/')
        check(status == 200 and 'Resto-Chef' in body and 'Add to cart' in body, 'packaged app renders through Apache and MySQL')
        check(any(cookie.secure for cookie in browser.jar), 'hosted session cookie is Secure')
        check(browser.request('/assets/app.css')[0] == 200, 'public assets are served')
        for path in ['/private/.env', '/private/app/config.php', '/private/public/index.php', '/PRIVATE/.env', '/.env', '/.git/config', '/demo.sql', '/demo-credentials.json']:
            status, body, _ = browser.request(path)
            check(status in (403,404) and password not in body, 'private/absent file is inaccessible: '+path)
        import http.client
        connection = http.client.HTTPConnection('127.0.0.1', httpport)
        connection.request('GET', '/cart')
        response = connection.getresponse()
        check(response.status in (301,302,307,308) and response.getheader('Location').startswith('https://'), 'HTTP redirects to HTTPS')
        connection.close()
        check(browser.request('/api/data.php?key=mishtikhabo')[0] == 410, 'legacy user-export endpoint remains retired')
        status, body, _ = browser.request('/cart/add', {'food_id':'1'})
        check(status == 403 and 'Your form expired' in body, 'missing CSRF returns a standard Forbidden response on Apache')
        check(browser.login(accounts['customer'])[0] == 200, 'generated customer credentials work on MySQL')
        check(browser.request('/admin')[0] == 403, 'customer cannot access staff dashboard')
        for fulfillment in ['pickup', 'delivery']:
            browser.request('/cart/add', {'_csrf':browser.token('/'), 'food_id':'1', 'quantity':'1'})
            _, checkout, _ = browser.request('/checkout?fulfillment='+fulfillment)
            token = re.search(r'name="_csrf" value="([a-f0-9]+)"', checkout).group(1)
            key = re.search(r'name="checkout_key" value="([a-f0-9]+)"', checkout).group(1)
            status, body, _ = browser.request('/checkout', {'_csrf':token,'checkout_key':key,'customer_name':'Demo Customer','phone':'+1 202 555 0199','fulfillment':fulfillment,'address':'42 Demo Street, Example City','notes':'Deployment integration test'})
            check(status == 200 and 'Demo Customer' in body, fulfillment+' checkout persists an order')
        staff = Browser(browser.base)
        check(staff.login(accounts['admin'])[0] == 200, 'generated staff credentials work on MySQL')
        for route, text in [('/admin','Kitchen overview'),('/admin/orders','Order desk'),('/admin/menu','Your menu')]:
            status, body, _ = staff.request(route)
            check(status == 200 and text in body, 'staff page works: '+route)
        check(run(mysql+['resto_demo', '-e', 'SELECT COUNT(*) FROM orders;']).strip() == '14', 'both HTTP orders are stored in MySQL')
        order_id=run(mysql+['resto_demo','-e','SELECT MAX(id) FROM orders;']).strip()
        for current, target in [('pending','preparing'),('preparing','ready'),('ready','out_for_delivery'),('out_for_delivery','completed')]:
            staff.request('/admin/orders/status', {'_csrf':staff.token('/admin/orders'),'order_id':order_id,'expected_status':current,'status':target})
            check(run(mysql+['resto_demo','-e','SELECT status FROM orders WHERE id='+order_id]).strip() == target, 'MySQL order transitions to '+target)
        staff.request('/admin/menu/availability', {'_csrf':staff.token('/admin/menu'),'food_id':'1','available':'0'})
        check(run(mysql+['resto_demo','-e','SELECT available FROM food WHERE id=1']).strip() == '0', 'staff availability change persists on MySQL')
        status, body, _ = staff.request('/admin')
        check(status == 200 and 'Completed orders' in body, 'sales dashboard renders after MySQL order completion')
    finally:
        # Use the isolated socket to stop our DB, never signal an installed service.
        subprocess.run(mysql+['-e', 'SHUTDOWN'], capture_output=True)
        for process in reversed(processes):
            if process.poll() is None:
                try: process.terminate()
                except PermissionError: pass
            try: process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait()
print(f'{checks} InfinityFree package checks passed.')
