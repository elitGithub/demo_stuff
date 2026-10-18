import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { Catalog } from '../src/dto/Catalog.mjs';
import { Overview } from '../src/dto/Overview.mjs';
import { EnquiryInput } from '../src/dto/EnquiryInput.mjs';
import { EnquiryRecord } from '../src/dto/EnquiryRecord.mjs';
import { BookingRecord } from '../src/dto/BookingRecord.mjs';
import { EnquiryStatus } from '../src/enums/EnquiryStatus.mjs';
import { BookingStatus } from '../src/enums/BookingStatus.mjs';

const source = await readFile(new URL('../assets/sandbox.js', import.meta.url), 'utf8');
const token = 'a'.repeat(64);
const bootstrap = (overrides = {}) => ({ csrfToken: token, expiresAt: 1800000000, created: true, protocolVersion: 1, idleSeconds: 14400, pageSize: 20, ...overrides });
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Headers({ 'Retry-After': '60' }), json: async () => structuredClone(payload) });
const deferred = () => { let resolve, reject; const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; }); return { promise, resolve, reject }; };
const createClient = fetchImplementation => {
  const realm = createContext({ window: { fetch: fetchImplementation }, DOMException });
  runInContext(source, realm);
  return new realm.window.ElsewhereSandboxClient(path => path, fetchImplementation);
};
const overview = () => JSON.parse(JSON.stringify(new Overview({
  enquiries: [new EnquiryRecord({ id: 1, reference: 'EW-DEMO-001', input: new EnquiryInput({ firstName: 'Alex', lastName: 'Demo', email: 'alex@travel.example', destination: 'italy', journey: 'italian-slow-days', departure: '2027-01-01', travelers: 2, budget: '$3,500–$5,000', message: '<script>fictional</script>' }), status: EnquiryStatus.New, createdAt: '2026-10-18T10:00:00.000Z' })],
  bookings: [new BookingRecord({ id: 1, enquiryId: null, reference: 'BK-DEMO-001', firstName: 'Alex', lastName: 'Demo', destination: 'italy', journey: 'italian-slow-days', departure: '', travelers: 2, value: 6500, status: BookingStatus.Planning, createdAt: '2026-10-18T10:00:00.000Z' })],
  catalog: Catalog.canonical()
})));

test('context_error_never_replays', async () => {
  const calls = [];
  const client = createClient(async (path, options) => {
    calls.push({ path, ...options });
    return path === '/api/sandbox' ? response(bootstrap()) : response({ error: 'Expired.', code: 'sandbox_context' }, 409);
  });
  await assert.rejects(client.request('/api/admin/overview'), { code: 'sandbox_context' });
  assert.equal(calls.length, 0);
  await client.initialize();
  await assert.rejects(client.request('/api/admin/enquiries/1', { method: 'PATCH', body: { status: 'closed' } }), { code: 'sandbox_context', status: 409 });
  assert.equal(client.context, null);
  assert.equal(calls.length, 2);
  await assert.rejects(client.request('/api/admin/overview'), { code: 'sandbox_context' });
  await client.initialize();
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(calls.filter(call => call.path === '/api/sandbox').length, 2);
  assert.equal(calls[1].headers['X-Elsewhere-Context'], token);
  assert.equal(calls[1].body, '{"status":"closed"}');
  assert.equal(calls[1].credentials, 'same-origin');
  assert.equal(calls[1].cache, 'no-store');
});

test('late_response_cannot_restore_old_state', async () => {
  const oldRead = deferred(), newRead = deferred();
  let count = 0;
  const calls = [];
  const client = createClient(async (path, options) => {
    calls.push({ path, ...options });
    if (path === '/api/sandbox') { return response(bootstrap({ csrfToken: ++count === 1 ? token : 'b'.repeat(64) })); }
    if (path === '/api/admin/logout') { return response({ ok: true }); }
    return count === 1 ? oldRead.promise : newRead.promise;
  });
  await client.initialize();
  let rendered = false;
  const old = client.request('/api/admin/overview').then(() => { rendered = true; });
  const rejection = assert.rejects(old, { name: 'AbortError' });
  client.cancelPending();
  assert.equal(client.context, token);
  await client.request('/api/admin/logout', { method: 'POST', body: {} });
  assert.equal(calls.at(-1).headers['X-Elsewhere-Context'], token);
  oldRead.resolve(response(overview()));
  await rejection;
  assert.equal(rendered, false);
  await client.initialize();
  const currentEpoch = client.epoch;
  const read = client.request('/api/admin/overview');
  client.invalidate();
  newRead.resolve(response({ error: 'Old context.', code: 'sandbox_context' }, 409));
  await assert.rejects(read, { name: 'AbortError' });
  assert.equal(client.epoch, currentEpoch + 1);
  assert.equal(client.context, null);
});

test('overlapping initializations and late parser failures cannot replace the winning context', async () => {
  const first = deferred(), second = deferred();
  let count = 0;
  const client = createClient(() => ++count === 1 ? first.promise : second.promise);
  const stale = client.initialize();
  const rejected = assert.rejects(stale, { name: 'AbortError' });
  const current = client.initialize();
  second.resolve(response(bootstrap({ csrfToken: 'b'.repeat(64) })));
  await current;
  first.resolve({ ok: true, json: async () => { throw new SyntaxError('Late broken JSON'); } });
  await rejected;
  assert.equal(client.context, 'b'.repeat(64));
});

test('fresh_page_vs_open_workflow and business errors keep their own recovery paths', async () => {
  let errorCode = 'conflict';
  let fetchCount = 0;
  const client = createClient(async path => {
    fetchCount++;
    return path === '/api/sandbox' ? response(bootstrap()) : response({ error: 'Try the action again.', code: errorCode }, errorCode === 'dashboard_access' ? 401 : 409);
  });
  assert.equal((await client.initialize()).created, true);
  for (const code of ['conflict', 'sandbox_full', 'dashboard_access', 'capacity', 'busy', 'rate_limited']) {
    errorCode = code;
    await assert.rejects(client.request('/api/admin/enquiries/1/booking', { method: 'POST', body: {} }), failure => failure.code === code && failure.retryAfter === '60');
    assert.equal(client.context, token);
  }
  errorCode = 'sandbox_context';
  await assert.rejects(client.request('/api/admin/overview'), { code: 'sandbox_context' });
  assert.equal(client.context, null);
  assert.equal(fetchCount, 8);
  await assert.rejects(client.request('/api/admin/login', { method: 'POST', body: {} }), { code: 'sandbox_context' });
  assert.equal(fetchCount, 8);
});

test('actual DTO overview is accepted and every post-initialization route carries captured context', async () => {
  const calls = [];
  const client = createClient(async (path, options) => {
    calls.push({ path, ...options });
    if (path === '/api/sandbox') { return response(bootstrap()); }
    if (path === '/api/admin/overview') { return response(overview()); }
    if (path === '/api/enquiries') { return response({ id: 5, reference: 'EW-12345678' }, 201); }
    if (path.endsWith('/booking')) { return response({ reference: 'BK-12345678' }, 201); }
    return response({ ok: true });
  });
  await client.initialize();
  assert.equal(calls[0].headers['X-Elsewhere-Context'], undefined);
  assert.deepEqual(await client.request('/api/admin/overview'), overview());
  for (const [path, method, body] of [
    ['/api/enquiries', 'POST', {}], ['/api/admin/login', 'POST', {}],
    ['/api/admin/enquiries/1', 'PATCH', { status: 'proposal' }],
    ['/api/admin/enquiries/1/booking', 'POST', {}], ['/api/admin/logout', 'POST', {}]
  ]) { await client.request(path, { method, body }); }
  for (const call of calls.slice(1)) { assert.equal(call.headers['X-Elsewhere-Context'], token); }
  assert.equal(client.context, token);
});

test('wire validation rejects malformed bootstrap, records, acknowledgements and errors', async () => {
  let payload = bootstrap();
  let status = 200;
  const client = createClient(async () => response(payload, status));
  for (const invalid of [null, [], {}, bootstrap({ csrfToken: 'A'.repeat(64) }), bootstrap({ protocolVersion: 2 }), bootstrap({ pageSize: 0 }), bootstrap({ expiresAt: '1800000000' }), { ...bootstrap(), cookie: token }]) {
    payload = invalid;
    await assert.rejects(client.initialize(), /invalid response/);
    assert.equal(client.context, null);
  }
  payload = bootstrap(); await client.initialize();
  for (const mutate of [
    value => { value.enquiries[0].id = Number.MAX_SAFE_INTEGER + 1; },
    value => { value.enquiries[0].status = 'unknown'; },
    value => { value.enquiries[0].travelers = 13; },
    value => { value.enquiries[0].departure = '2027-02-30'; },
    value => { value.enquiries[0].createdAt = 'not a date'; },
    value => { value.enquiries.push(value.enquiries[0]); },
    value => { value.bookings[0].enquiryId = 0; },
    value => { value.bookings[0].value = -1; },
    value => { value.bookings[0].status = 'new'; },
    value => { value.catalog.journeys[0].title = 42; },
    value => { value.catalog.destinations = null; },
    value => { value.enquiries = Array(101).fill(value.enquiries[0]); },
    value => { value.bookings = Array(104).fill(value.bookings[0]); },
    value => { value.cookie = token; }
  ]) {
    payload = overview(); mutate(payload);
    await assert.rejects(client.request('/api/admin/overview'), /invalid response/);
    assert.equal(client.context, token);
  }
  for (const invalid of [{}, { ok: false }, { ok: 'true' }, { ok: true, cookie: token }]) {
    payload = invalid;
    await assert.rejects(client.request('/api/admin/login', { method: 'POST', body: {} }), /invalid response/);
  }
  for (const invalid of [{ error: 'Oops', code: 'unknown' }, { error: 5, code: 'sandbox_context' }, { error: 'Oops' }, { error: 'Oops', code: 'sandbox_context', cookie: token }]) {
    payload = invalid; status = 409;
    await assert.rejects(client.request('/api/admin/overview'), /invalid error/);
    assert.equal(client.context, token);
  }
});

test('network failures do not replay mutations or discard a valid generation', async () => {
  let count = 0;
  const client = createClient(async path => { count++; if (path === '/api/sandbox') { return response(bootstrap()); } throw new TypeError('Network offline'); });
  await client.initialize();
  await assert.rejects(client.request('/api/admin/enquiries/1', { method: 'PATCH', body: { status: 'closed' } }), /Network offline/);
  assert.equal(count, 2);
  assert.equal(client.context, token);
});

test('a superseded transport rejection is AbortError even when the thrown error has a context code', async () => {
  const waiting = deferred();
  const client = createClient(path => path === '/api/sandbox' ? response(bootstrap()) : waiting.promise);
  await client.initialize();
  const stale = client.request('/api/admin/overview');
  const rejected = assert.rejects(stale, { name: 'AbortError' });
  client.cancelPending();
  waiting.reject(Object.assign(new Error('Old context failure'), { code: 'sandbox_context' }));
  await rejected;
  assert.equal(client.context, token);
});
