#!/usr/bin/env python3
"""Black-box regression tests. Uses an isolated DB/server; never changes demo data."""
import http.cookiejar
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
checks = 0

def check(condition, message):
    global checks
    assert condition, message
    checks += 1
    print('PASS', message, flush=True)

class Browser:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
    def request(self, path, data=None):
        request = urllib.request.Request(self.base + path, data=None if data is None else urllib.parse.urlencode(data, doseq=True).encode())
        try:
            response = self.client.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        return response.status, response.read().decode(), response.headers
    def get(self, path):
        return self.request(path)
    def post(self, path, data):
        return self.request(path, data)
    def token(self, path='/login'):
        code, body, _ = self.get(path)
        assert code == 200, (path, code, body[:300])
        return re.search(r'name="_csrf" value="([a-f0-9]+)"', body).group(1)
    def login(self, email, password):
        return self.post('/login', {'_csrf': self.token(), 'email': email, 'password': password})

with tempfile.TemporaryDirectory(prefix='restrogirls-http-') as temporary:
    env = dict(os.environ, DB_DRIVER='sqlite', DB_PATH=temporary+'/test.sqlite', APP_TIMEZONE='UTC')
    setup = subprocess.run(['php', 'bin/setup.php', '--demo', '--json'], cwd=ROOT, env=env, capture_output=True, text=True)
    assert setup.returncode == 0, setup.stderr + setup.stdout
    accounts = json.loads(setup.stdout)
    sock = socket.socket(); sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]; sock.close()
    base = f'http://127.0.0.1:{port}'
    with open(temporary+'/server.log','w') as log:
        server = subprocess.Popen(['php','-S',f'127.0.0.1:{port}','-t','public','public/router.php'], cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
            visitor = Browser(base)
            for _ in range(50):
                try: visitor.get('/'); break
                except (urllib.error.URLError,ConnectionError): time.sleep(.1)
            status, body, headers = visitor.get('/')
            check(status == 200 and 'Add to cart' in body, 'menu renders with real food and prices')
            check("default-src 'self'" in headers.get('Content-Security-Policy',''), 'restrictive CSP present')
            check(headers.get('X-Content-Type-Options') == 'nosniff', 'nosniff header present')
            cookie = headers.get('Set-Cookie','')
            # Cookie may have been set by the first readiness request.
            check(all(c.has_nonstandard_attr('HttpOnly') for c in visitor.jar), 'session cookie is HttpOnly')
            for path in ['/api/data.php?key=mishtikhabo','/RestroGirls/api/data.php?key=mishtikhabo']:
                status,body,_=visitor.get(path)
                check(status == 410 and 'password' not in body.lower(), 'old user-export API permanently retired')
            for path in ['/storage/demo.sqlite','/.env','/app/config.php','/mishtidb.sql','/bin/setup.php','/tests/domain.php','/assets/../../.env','/%2e%2e/.env']:
                status,body,_=visitor.get(path)
                check(status in (403,404), 'private path blocked: '+path)
            status,_,_=visitor.post('/cart/add',{'food_id':'1','quantity':'1'})
            check(status == 403, 'POST without CSRF rejected')
            status,_,_=visitor.get('/cart/add?food_id=1&quantity=1')
            check(status == 405, 'GET cannot mutate cart')
            status,body,_=visitor.get('/admin')
            check(status == 200 and 'Sign in' in body, 'staff screen redirects anonymous visitors to login')
            status,body,_=visitor.login("' OR 1=1 --",'bad-password')
            check('Email or password is incorrect' in body, 'SQL injection login denied without database errors')
            customer=Browser(base)
            status,body,_=customer.login(accounts['customer']['email'], accounts['customer']['password'])
            check(status == 200 and 'Sign out' in body, 'customer login works')
            status,_,_=customer.get('/admin')
            check(status == 403, 'customer cannot read staff dashboard')
            status,_,_=customer.post('/admin/menu/save',{'_csrf':customer.token('/cart'),'name':'Unauthorized'})
            check(status == 403, 'customer cannot mutate staff data')
            for item,quantity in [(1,2),(2,1)]:
                status,_,_=customer.post('/cart/add',{'_csrf':customer.token('/cart'),'food_id':str(item),'quantity':str(quantity)})
                check(status == 200, 'cart accepts a valid available item')
            status,body,_=customer.get('/checkout?fulfillment=delivery')
            token=re.search(r'name="_csrf" value="([a-f0-9]+)"',body).group(1)
            key=re.search(r'name="checkout_key" value="([a-f0-9]+)"',body).group(1)
            payload={'_csrf':token,'checkout_key':key,'fulfillment':'delivery','customer_name':'Web Customer','phone':'+1 555 010 1234','address':'22 Test Street, Apartment 4','notes':'Please ring once','total_cents':'1','price':'0.01'}
            db=sqlite3.connect(temporary+'/test.sqlite')
            before=db.execute('SELECT COUNT(*) FROM orders').fetchone()[0]
            status,body,_=customer.post('/checkout',payload)
            check(status == 200 and 'Order received' in body, 'delivery checkout creates an order and confirmation')
            order=db.execute('SELECT id,total_cents,status FROM orders ORDER BY id DESC LIMIT 1').fetchone()
            prices=dict(db.execute('SELECT id,price_cents FROM food').fetchall())
            check(order[1] == prices[1]*2+prices[2]+350, 'client-supplied total ignored')
            status,body,_=customer.post('/checkout',payload)
            check(db.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == before+1, 'HTTP checkout replay does not duplicate order')
            customer.post('/cart/add',{'_csrf':customer.token('/cart'),'food_id':'2','quantity':'1'})
            customer.post('/checkout',payload)
            status,cart_body,_=customer.get('/cart')
            check('Crispy vegetable bites' in cart_body, 'replaying a completed checkout preserves a newly started cart')
            status,checkout_body,_=customer.get('/checkout')
            fresh_key=re.search(r'name="checkout_key" value="([a-f0-9]+)"',checkout_body).group(1)
            status,body,_=customer.post('/checkout',{'_csrf':customer.token('/cart'),'checkout_key':fresh_key,'fulfillment[]':'delivery'})
            check(status == 200 and 'Please check your form' in body, 'malformed fulfillment recovers without server error')
            status,body,_=customer.get('/orders/'+str(order[0]))
            check(status == 200 and '22 Test Street' in body, 'customer can review their order')
            stranger=Browser(base)
            status,_,_=stranger.post('/register',{'_csrf':stranger.token('/register'),'name':'Another Tester','email':'test-new@example.test','password':'Another-test-password-412!','role':'admin'})
            check(status == 200, 'registration accepts valid customer')
            status,_,_=stranger.get('/orders/'+str(order[0]))
            check(status == 404, 'another customer cannot access guessed order ID')
            status,_,_=stranger.get('/admin')
            check(status == 403, 'posted role cannot grant admin rights')
            admin=Browser(base)
            status,body,_=admin.login(accounts['admin']['email'],accounts['admin']['password'])
            check(status == 200 and 'Overview' in body, 'staff login opens dashboard')
            for current,target in [('pending','preparing'),('preparing','ready'),('ready','out_for_delivery'),('out_for_delivery','completed')]:
                status,body,_=admin.post('/admin/orders/status',{'_csrf':admin.token('/admin/orders'),'order_id':order[0],'expected_status':current,'status':target})
                check(db.execute('SELECT status FROM orders WHERE id=?',(order[0],)).fetchone()[0] == target, 'staff advances order to '+target)
            status,body,_=admin.get('/admin')
            check(status == 200 and 'Completed sales' in body and 'Popular dishes' in body, 'sales dashboard renders after completion')
            status,_,_=admin.post('/admin/menu/availability',{'_csrf':admin.token('/admin/menu'),'food_id':'1','available':'0'})
            check(db.execute('SELECT available FROM food WHERE id=1').fetchone()[0] == 0, 'staff can mark food unavailable')
            status,body,_=customer.post('/cart/add',{'_csrf':customer.token('/cart'),'food_id':'1','quantity':'1'})
            check('unavailable' in body.lower() and not db.in_transaction, 'unavailable items cannot be ordered')
            status,body,_=admin.post('/admin/categories',{'_csrf':admin.token('/admin/menu'), 'name':'<script>alert(1)</script>'})
            check('<script>alert(1)</script>' not in body and '&lt;script&gt;' in body, 'stored category text escaped in HTML')
            status,body,_=admin.post('/logout',{'_csrf':admin.token('/admin')})
            status,body,_=admin.get('/admin')
            check('Sign in' in body, 'logout removes staff session')
            db.close()
        except BaseException:
            log.flush()
            print('\n'.join(line for line in Path(temporary+'/server.log').read_text().splitlines() if any(word in line for word in ['error:', 'Error:', 'application:'])))
            raise
        finally:
            server.terminate(); server.wait(timeout=5)
print(f'\n{checks} HTTP checks passed.')
