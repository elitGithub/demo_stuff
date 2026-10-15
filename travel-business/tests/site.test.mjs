import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createStore, validateEnquiry } from '../src/store.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
let temporary, child, base, cookie;
const valid = () => ({ firstName: 'Alex', lastName: 'Demo', email: 'alex@example.com', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, budget: '$3,500–$5,000', message: 'A relaxed trip for two.', consent: true });
const post = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
before(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'elsewhere-test-'));
  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.mjs'], { cwd: root, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DB_PATH: join(temporary, 'api.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
});
after(async () => {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
  if (temporary) await rm(temporary, { recursive: true, force: true });
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

test('enquiries and bookings are not listed without a demo session', async () => {
  assert.equal((await fetch(base + '/api/admin/overview')).status, 401);
  assert.equal((await post('/api/admin/enquiries/1/booking', {})).status, 401);
  assert.equal((await fetch(base + '/api/enquiries')).status, 404);
});

test('cross-origin submissions and invalid content types are rejected', async () => {
  assert.equal((await post('/api/enquiries', valid(), { Origin: 'https://other.example' })).status, 403);
  assert.equal((await post('/api/admin/login', {}, { Origin: 'null' })).status, 403);
  assert.equal((await fetch(base + '/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' })).status, 400);
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
  assert.throws(() => validateEnquiry(null));
  assert.throws(() => validateEnquiry([]));
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
  cookie = setCookie.split(';')[0];
  let overview = await (await fetch(base + '/api/admin/overview', { headers: { Cookie: cookie } })).json();
  const record = overview.enquiries.find(e => e.id === saved.id);
  assert.equal(record.email, 'alex@example.com');
  assert.equal(record.status, 'new');
  assert.equal(record.message, '<script>alert("demo")</script> — saved as plain text');
  const update = await fetch(`${base}/api/admin/enquiries/${saved.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ status: 'proposal' }) });
  assert.equal(update.status, 200);
  overview = await (await fetch(base + '/api/admin/overview', { headers: { Cookie: cookie } })).json();
  assert.equal(overview.enquiries.find(e => e.id === saved.id).status, 'proposal');
  const conversion = await post(`/api/admin/enquiries/${saved.id}/booking`, {}, { Cookie: cookie });
  assert.equal(conversion.status, 201);
  assert.equal((await post(`/api/admin/enquiries/${saved.id}/booking`, {}, { Cookie: cookie })).status, 409);
  overview = await (await fetch(base + '/api/admin/overview', { headers: { Cookie: cookie } })).json();
  const booking = overview.bookings.find(b => b.enquiryId === saved.id);
  assert.equal(booking.status, 'planning');
  assert.equal(booking.value, 6500);
  assert.equal(overview.enquiries.find(e => e.id === saved.id).status, 'converted');
  const reopen = await fetch(`${base}/api/admin/enquiries/${saved.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ status: 'new' }) });
  assert.equal(reopen.status, 409);
});

test('logout revokes dashboard access', async () => {
  assert.equal((await post('/api/admin/logout', {}, { Cookie: cookie })).status, 200);
  assert.equal((await fetch(base + '/api/admin/overview', { headers: { Cookie: cookie } })).status, 401);
});

test('SQLite retains enquiries and status changes across reopening without duplicate seeds', () => {
  const path = join(temporary, 'persistence.sqlite');
  let db = createStore(path);
  const seedCount = db.overview().enquiries.length;
  const saved = db.createEnquiry(valid());
  db.updateStatus(saved.id, 'contacted');
  db.close();
  db = createStore(path);
  const records = db.overview().enquiries;
  assert.equal(records.length, seedCount + 1);
  assert.equal(records.find(e => e.reference === saved.reference).status, 'contacted');
  db.close();
});

test('public JavaScript and CSS are self-hosted with no third-party runtime requests', async () => {
  for (const path of ['assets/app.js', 'assets/admin.js', 'assets/styles.css']) {
    const source = await readFile(join(root, path), 'utf8');
    assert.doesNotMatch(source, /https?:\/\//);
  }
});
