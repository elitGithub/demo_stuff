import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/store.mjs';
import { EnquiryValidator } from '../src/EnquiryValidator.mjs';
import { Catalog } from '../src/dto/Catalog.mjs';
import { StatusChange } from '../src/dto/StatusChange.mjs';
import { EnquiryStatus } from '../src/enums/EnquiryStatus.mjs';
import { TestWorkspace } from './support/TestWorkspace.mjs';
import { ApiClient } from './support/ApiClient.mjs';
import { SandboxConfig } from '../src/dto/SandboxConfig.mjs';
import { ApiController } from '../src/ApiController.mjs';
import { ApiResult } from '../src/dto/ApiResult.mjs';
import { CookieChange } from '../src/dto/CookieChange.mjs';
import { Acknowledgement } from '../src/dto/Acknowledgement.mjs';
import { InputError } from '../src/InputError.mjs';
import { ErrorCode } from '../src/enums/ErrorCode.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let temporary, child, base, visitor, runtimeRoot;
const valid = () => ({ firstName: 'Alex', lastName: 'Demo', email: 'alex@travel.example', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, budget: '$3,500–$5,000', message: 'A relaxed trip for two.', consent: true });
const validator = new EnquiryValidator(Catalog.canonical(), () => Math.floor(Date.now() / 1000));
const post = (path, data, headers = {}) => visitor.request('POST', path, data, { headers });
before(async () => {
  temporary = await TestWorkspace.create();
  runtimeRoot = temporary.path('api-runtime');
  await writeFile(temporary.path('legacy.sqlite'), 'legacy database sentinel');
  await writeFile(temporary.path('config.json'), JSON.stringify({ allocationLimit: 100 }));
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], { cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', PUBLIC_ORIGIN: '', SANDBOX_ROOT: runtimeRoot, SANDBOX_CONFIG_FILE: temporary.path('config.json'), DB_PATH: temporary.path('legacy.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
  base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test server startup timed out.')), 10000);
    let output = '', errors = '';
    child.stderr.on('data', chunk => { errors += chunk; });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); if (!base) reject(new Error(`Test server exited (${code}): ${errors}`)); });
  });
  visitor = new ApiClient(base);
  assert.equal((await visitor.initialize()).status, 200);
});
after(async () => {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  if (temporary) await temporary.close();
});

test('all six public pages and dashboard render with valid local links and assets', async () => {
  const files = ['index.html', 'destinations.html', 'journeys.html', 'about.html', 'journal.html', 'contact.html', 'admin.html'];
  const resources = new Set();
  for (const file of files) {
    const response = await fetch(`${base}/${file}`);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    const html = await response.text();
    assert.match(html, /<title>[^<]+\| Elsewhere<\/title>/);
    assert.match(html, /<meta name="description"/);
    assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, file === 'admin.html' ? 2 : 1);
    for (const match of html.matchAll(/(?:href|src)="([^"#?]+)(?:[?#][^"]*)?"/g)) {
      if (!match[1].startsWith('http')) resources.add(match[1]);
    }
  }
  for (const resource of resources) assert.equal((await fetch(`${base}/${resource}`, { method: 'HEAD' })).status, 200, resource);
});

test('private source and database paths are never served', async () => {
  for (const path of ['/server.mjs', '/src/store.mjs', '/storage/demo.sqlite', '/assets/../../server.mjs', '/%2e%2e%2fserver.mjs', '/.env', '/missing.html']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('enquiries and bookings require context before dashboard access', async () => {
  assert.equal((await fetch(base + '/api/admin/overview')).status, 409);
  assert.equal((await post('/api/admin/enquiries/1/booking', {})).status, 401);
  const wrongMethod = await fetch(base + '/api/enquiries');
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
});

test('cross-origin submissions and invalid content types are rejected', async () => {
  assert.equal((await post('/api/enquiries', valid(), { Origin: 'https://other.example' })).status, 403);
  assert.equal((await post('/api/admin/login', {}, { Origin: 'null' })).status, 403);
  assert.equal((await visitor.request('POST', '/api/enquiries', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await visitor.request('POST', '/api/enquiries', {}, { body: '{broken' })).status, 400);
  assert.equal((await post('/api/enquiries', { ...valid(), message: 'a'.repeat(17000) })).status, 413);
});

test('server validates required fields, enums, dates, party size and consent', async () => {
  const invalid = [
    { firstName: '   ' }, { email: 'not-an-email' }, { destination: 'unknown' }, { journey: 'unknown' },
    { destination: 'bali' }, { travelers: 0 }, { travelers: 13 }, { travelers: 2.5 }, { travelers: '2' },
    { consent: false }, { consent: 'true' }, { departure: '2099-02-30' }, { departure: '2000-01-01' },
    { budget: 'arbitrary' }, { message: 'a'.repeat(2001) }, { firstName: ['Alex'] }
  ];
  for (const change of invalid) {
    const response = await post('/api/enquiries', { ...valid(), ...change });
    assert.equal(response.status, 400, JSON.stringify(change).slice(0, 100));
  }
  assert.throws(() => validator.validate(null));
  assert.throws(() => validator.validate([]));
});

test('a submitted enquiry is saved, can be followed up, and converts exactly once', async () => {
  const created = await post('/api/enquiries', { ...valid(), message: '<script>alert("demo")</script> — saved as plain text' });
  assert.equal(created.status, 201);
  const saved = await created.json();
  assert.match(saved.reference, /^EW-[A-F0-9]{8}$/);
  const login = await post('/api/admin/login', {});
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  let overview = await (await visitor.request('GET', '/api/admin/overview')).json();
  const record = overview.enquiries.find(e => e.id === saved.id);
  assert.equal(record.email, 'alex@travel.example');
  assert.equal(record.status, 'new');
  assert.equal(record.message, '<script>alert("demo")</script> — saved as plain text');
  const update = await visitor.request('PATCH', `/api/admin/enquiries/${saved.id}`, { status: 'proposal' });
  assert.equal(update.status, 200);
  overview = await (await visitor.request('GET', '/api/admin/overview')).json();
  assert.equal(overview.enquiries.find(e => e.id === saved.id).status, 'proposal');
  const conversion = await post(`/api/admin/enquiries/${saved.id}/booking`, {});
  assert.equal(conversion.status, 201);
  const duplicate = await post(`/api/admin/enquiries/${saved.id}/booking`, {});
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, 'conflict');
  assert.equal(duplicate.headers.getSetCookie().length, 2);
  overview = await (await visitor.request('GET', '/api/admin/overview')).json();
  const booking = overview.bookings.find(b => b.enquiryId === saved.id);
  assert.equal(booking.status, 'planning');
  assert.equal(booking.value, 6500);
  assert.equal(overview.enquiries.find(e => e.id === saved.id).status, 'converted');
  const reopen = await visitor.request('PATCH', `/api/admin/enquiries/${saved.id}`, { status: 'new' });
  assert.equal(reopen.status, 409);
});

test('logout revokes dashboard access', async () => {
  const oldCookie = visitor.cookieHeader();
  assert.equal((await post('/api/admin/logout', {})).status, 200);
  assert.equal((await visitor.request('GET', '/api/admin/overview', null, { headers: { Cookie: oldCookie } })).status, 401);
  assert.equal((await post('/api/admin/login', {})).status, 200);
  const overview = await (await visitor.request('GET', '/api/admin/overview')).json();
  assert.equal(overview.enquiries.find(record => record.email === valid().email).status, 'converted');
});

test('SQLite retains enquiries and status changes across reopening without duplicate seeds', () => {
  const path = temporary.path('persistence.sqlite');
  const config = SandboxConfig.from({});
  let db = createStore(path, config, Catalog.canonical(), () => Math.floor(Date.now() / 1000), true);
  const seedCount = db.overview().enquiries.length;
  const saved = db.createEnquiry(validator.validate(valid()));
  db.updateStatus(new StatusChange({ id: saved.id, status: EnquiryStatus.Contacted }));
  db.close();
  db = createStore(path, config, Catalog.canonical(), () => Math.floor(Date.now() / 1000), false);
  const records = db.overview().enquiries;
  assert.equal(records.length, seedCount + 1);
  assert.equal(records.find(record => record.reference === saved.reference).status, EnquiryStatus.Contacted);
  db.close();
});

test('public JavaScript and CSS are self-hosted with no third-party runtime requests', async () => {
  for (const path of ['assets/sandbox.js', 'assets/dashboard-pagination.js', 'assets/app.js', 'assets/admin.js', 'assets/styles.css']) {
    const source = await readFile(join(root, path), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//);
  }
});

test('public_submission_follows_its_cookie and overlapping seed IDs stay isolated', async () => {
  const first = new ApiClient(base), second = new ApiClient(base);
  await first.initialize(); await second.initialize();
  const created = await (await first.request('POST', '/api/enquiries', { ...valid(), email: 'private@visitor.example' })).json();
  await first.request('POST', '/api/admin/login', {}); await second.request('POST', '/api/admin/login', {});
  const firstOverview = await (await first.request('GET', '/api/admin/overview')).json();
  const secondOverview = await (await second.request('GET', '/api/admin/overview')).json();
  assert.equal(firstOverview.enquiries.length, 5);
  assert.equal(secondOverview.enquiries.length, 4);
  assert.equal(firstOverview.enquiries.find(record => record.id === created.id).email, 'private@visitor.example');
  assert.equal((await second.request('PATCH', `/api/admin/enquiries/${created.id}`, { status: 'closed' })).status, 404);
  await second.request('PATCH', '/api/admin/enquiries/1', { status: 'closed' });
  assert.notEqual((await (await first.request('GET', '/api/admin/overview')).json()).enquiries.find(record => record.id === 1).status, 'closed');
  await second.request('POST', '/api/admin/enquiries/1/booking', {});
  assert.equal((await (await first.request('GET', '/api/admin/overview')).json()).bookings.length, 3);
});

test('mixed_credentials_and_revoked_login reject swaps, rotations and missing context', async () => {
  const first = new ApiClient(base), second = new ApiClient(base);
  await first.initialize(); await second.initialize();
  await first.request('POST', '/api/admin/login', {}); await second.request('POST', '/api/admin/login', {});
  assert.equal((await first.request('GET', '/api/admin/overview', null, { headers: { Origin: null } })).status, 200);
  const duplicateDashboard = `${first.cookieHeader()}; elsewhere_dashboard_v1=${first.cookies.get('elsewhere_dashboard_v1')}`;
  assert.equal((await first.request('GET', '/api/admin/overview', null, { headers: { Cookie: duplicateDashboard } })).status, 400);
  const mixed = `elsewhere_sandbox_v1=${first.cookies.get('elsewhere_sandbox_v1')}; elsewhere_dashboard_v1=${second.cookies.get('elsewhere_dashboard_v1')}`;
  assert.equal((await first.request('GET', '/api/admin/overview', null, { headers: { Cookie: mixed } })).status, 401);
  assert.equal((await first.request('GET', '/api/admin/overview', null, { headers: { 'X-Elsewhere-Context': null } })).status, 409);
  const old = first.cookieHeader();
  await first.request('POST', '/api/admin/login', {});
  assert.equal((await first.request('GET', '/api/admin/overview', null, { headers: { Cookie: old } })).status, 401);
  const activity = await first.request('POST', '/api/enquiries', valid());
  assert.equal(activity.headers.getSetCookie().length, 2);
  const current = first.cookieHeader();
  const logout = await first.request('POST', '/api/admin/logout', {});
  assert.match(logout.headers.getSetCookie().find(cookie => cookie.startsWith('elsewhere_dashboard_v1=')), /Max-Age=0/);
  assert.equal((await first.request('GET', '/api/admin/overview', null, { headers: { Cookie: current } })).status, 401);
  await first.request('POST', '/api/admin/login', {});
  assert.equal((await (await first.request('GET', '/api/admin/overview')).json()).enquiries.length, 5);
});

test('cookie_contract_and_first_visit_race bind generation to the winning cookie', async () => {
  const first = new ApiClient(base), second = new ApiClient(base);
  const responses = await Promise.all([first.initialize(), second.initialize()]);
  assert.notEqual(first.context, second.context);
  for (const response of responses) {
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 1);
    assert.match(cookies[0], /^elsewhere_sandbox_v1=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=14400$/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const winningCookie = second.cookieHeader();
  assert.equal((await first.request('POST', '/api/admin/login', {}, { headers: { Cookie: winningCookie } })).status, 409);
  assert.equal((await second.request('POST', '/api/admin/login', {})).status, 200);
  const overview = await (await second.request('GET', '/api/admin/overview')).json();
  assert.equal(overview.enquiries.length, 4);
});

test('stale_generation_cannot_replay after exact fixture lease expiry', async () => {
  const client = new ApiClient(base);
  await client.initialize(); await client.request('POST', '/api/admin/login', {});
  const oldContext = client.context;
  const digest = createHash('sha256').update(client.cookies.get('elsewhere_sandbox_v1')).digest('hex');
  const path = join(runtimeRoot, 'registry.json');
  const registry = JSON.parse(await readFile(path, 'utf8'));
  registry.sandboxes[digest].lastActivity = Math.floor(Date.now() / 1000) - 14400;
  await writeFile(path, JSON.stringify(registry), { mode: 0o600 });
  assert.equal((await client.request('PATCH', '/api/admin/enquiries/1', { status: 'closed' })).status, 409);
  const fresh = await client.initialize();
  assert.equal((await fresh.json()).created, true);
  await client.request('POST', '/api/admin/login', {});
  for (const [method, route, body] of [['PATCH', '/api/admin/enquiries/1', { status: 'closed' }], ['POST', '/api/admin/enquiries/1/booking', {}]]) {
    assert.equal((await client.request(method, route, body, { headers: { 'X-Elsewhere-Context': oldContext } })).status, 409);
  }
  const overview = await (await client.request('GET', '/api/admin/overview')).json();
  assert.notEqual(overview.enquiries.find(record => record.id === 1).status, 'closed');
  assert.equal(overview.bookings.length, 3);
});

test('rejected_requests_have_no_activity and cannot trust Host or forwarding metadata', async () => {
  const client = new ApiClient(base);
  await client.initialize();
  const path = join(runtimeRoot, 'registry.json');
  const digest = createHash('sha256').update(client.cookies.get('elsewhere_sandbox_v1')).digest('hex');
  const registry = JSON.parse(await readFile(path, 'utf8'));
  registry.sandboxes[digest].lastActivity -= 100;
  await writeFile(path, JSON.stringify(registry), { mode: 0o600 });
  const before = await readFile(path, 'utf8');
  const cases = [
    ['POST', '/api/sandbox', {}, { headers: { Origin: null } }, 403],
    ['POST', '/api/sandbox', {}, { headers: { Origin: 'null' } }, 403],
    ['POST', '/api/sandbox', {}, { headers: { Origin: 'https://evil.example', Host: 'evil.example', Forwarded: 'host=evil.example;proto=https', 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.12' } }, 403],
    ['GET', '/api/admin/overview', null, { headers: { Origin: 'https://evil.example' } }, 403],
    ['GET', '/api/admin/overview', null, { headers: { 'Sec-Fetch-Site': 'cross-site' } }, 403],
    ['POST', '/api/enquiries', valid(), { headers: { 'X-Elsewhere-Context': 'a'.repeat(64) } }, 409],
    ['POST', '/api/unknown', {}, null, 404],
    ['POST', '/api/sandbox', { sandbox: 'selector' }, null, 400],
    ['POST', '/api/admin/login', {}, { headers: { Cookie: `${client.cookieHeader()}; ${client.cookieHeader()}` } }, 400],
    ['POST', '/api/enquiries', {}, { body: '[1]' }, 400],
    ['POST', '/api/enquiries', {}, { body: 'null' }, 400],
    ['POST', '/api/enquiries', {}, { body: '{bad' }, 400],
    ['POST', '/api/enquiries', {}, { body: Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125]) }, 400],
    ['POST', '/api/enquiries', { ...valid(), message: 'x'.repeat(17000) }, null, 413],
    ['POST', '/api/admin/enquiries/9007199254740992/booking', {}, null, 400],
    ['PATCH', '/api/admin/enquiries/0', { status: 'closed' }, null, 400]
  ];
  for (const [method, route, body, overrides, status] of cases) {
    const response = await client.request(method, route, body, overrides);
    assert.equal(response.status, status, route);
    assert.equal(response.headers.getSetCookie().length, 0, route);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(typeof (await response.json()).code, 'string');
  }
  assert.equal(await readFile(path, 'utf8'), before);
  const forged = await client.request('POST', '/api/admin/login', {}, { headers: { Host: 'evil.example', 'X-Forwarded-For': '192.0.2.20' } });
  assert.equal(forged.status, 200);
  assert.doesNotMatch(forged.headers.getSetCookie().join(';'), /Secure/);
  const after = JSON.parse(await readFile(path, 'utf8'));
  const directBucket = createHash('sha256').update('login\0' + '127.0.0.1').digest('hex');
  assert.ok(after.rateBuckets[directBucket]);
  const forgedBucket = createHash('sha256').update('login\0' + '192.0.2.20').digest('hex');
  assert.equal(after.rateBuckets[forgedBucket], undefined);
});

test('chunked over-limit input and aborted partial bodies never hold the runtime lock', async () => {
  const client = new ApiClient(base);
  await client.initialize();
  const headers = { Origin: base, Cookie: client.cookieHeader(), 'X-Elsewhere-Context': client.context, 'Content-Type': 'application/json' };
  const registryPath = join(runtimeRoot, 'registry.json');
  const before = await readFile(registryPath, 'utf8');
  const oversized = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/enquiries', { method: 'POST', headers }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => { resolve({ status: response.statusCode, body: JSON.parse(text) }); });
    });
    request.on('error', reject);
    request.write('{"message":"'); request.write('x'.repeat(17000)); request.end('"}');
  });
  assert.equal(oversized.status, 413); assert.equal(oversized.body.code, 'body_too_large');
  assert.equal(await readFile(registryPath, 'utf8'), before);
  const partial = httpRequest(base + '/api/enquiries', { method: 'POST', headers: { ...headers, 'Content-Length': '1000' } });
  partial.on('error', () => {});
  partial.write('{"message":"unfinished');
  const started = Date.now();
  assert.equal((await client.request('POST', '/api/admin/login', {})).status, 200);
  assert.ok(Date.now() - started < 1500);
  partial.destroy();
  assert.equal((await (await client.request('GET', '/api/admin/overview')).json()).enquiries.length, 4);
});

test('old cookie and DB_PATH sentinel never authorize or supply records', async () => {
  const response = await fetch(base + '/api/admin/overview', { headers: { Cookie: 'elsewhere_demo=' + 'a'.repeat(64), 'X-Elsewhere-Context': 'b'.repeat(64) } });
  assert.equal(response.status, 409);
  assert.equal(await readFile(temporary.path('legacy.sqlite'), 'utf8'), 'legacy database sentinel');
  assert.doesNotMatch(await readFile(join(root, 'server.mjs'), 'utf8'), /DB_PATH|demo\.sqlite/);
  assert.throws(() => createStore(temporary.path('implicit.sqlite')), /Explicit store/);
  await assert.rejects(access(temporary.path('implicit.sqlite')));
});

test('HTTPS origin transforms success and admitted-error cookies with retry metadata', async () => {
  const config = SandboxConfig.from({});
  const cookie = new CookieChange({ name: config.sandboxCookie, value: 'a'.repeat(64), path: '/', secure: false, maxAge: config.idleSeconds });
  for (const failure of [false, true]) {
    const runtime = { execute: async () => {
      if (failure) { throw new InputError('Admitted failure.', 503, ErrorCode.Busy, 2, [cookie]); }
      return new ApiResult({ payload: new Acknowledgement(), cookies: [cookie] });
    } };
    const controller = new ApiController(runtime, Catalog.canonical(), config, 'https://configured.example', () => 1);
    const response = { destroyed: false, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(body) { this.body = JSON.parse(body); } };
    await controller.handle({ method: 'GET', url: '/api/admin/overview', headers: { origin: 'https://configured.example', 'x-elsewhere-context': 'b'.repeat(64), host: 'untrusted.example', 'x-forwarded-proto': 'http' }, socket: { remoteAddress: '127.0.0.1' } }, response);
    assert.equal(response.status, failure ? 503 : 200);
    assert.match(response.headers['Set-Cookie'][0], /; Secure$/);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    if (failure) { assert.equal(response.headers['Retry-After'], '2'); assert.equal(response.body.code, 'busy'); }
  }
  for (const origin of ['https://configured.example/', 'https://configured.example/path', 'ftp://configured.example', 'https://user:pass@configured.example']) {
    assert.throws(() => new ApiController({}, Catalog.canonical(), config, origin, () => 1));
  }
});
