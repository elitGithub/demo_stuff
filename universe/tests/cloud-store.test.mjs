import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createTransport, digest, readCredentials } from '../src/r2.mjs';
import { CloudStore } from '../src/sync/CloudStore.mjs';
import { Retry } from '../src/sync/Retry.mjs';
import { SyncSettings } from '../src/sync/SyncSettings.mjs';
import { MemoryBucket } from './support/MemoryBucket.mjs';

const controlKey = '_universe/v2/control.json';
const hash = 'a'.repeat(64);

/**
 * @param {string} id
 * @returns {string}
 */
function manifestKey(id) {
  return `_universe/v2/manifests/${id}.json`;
}

/**
 * @param {string} blobHash
 * @returns {string}
 */
function blobKey(blobHash) {
  return `_universe/v2/blobs/${blobHash}`;
}

/**
 * @param {MemoryBucket} bucket
 * @returns {number}
 */
function manifestReads(bucket) {
  return bucket.requests.filter((request) => request.key.includes('/manifests/')).length;
}

/**
 * @returns {{time: number, sleeps: number[], now: Function, sleep: Function}}
 */
function fakeClock() {
  const clock = {
    time: 0,
    sleeps: [],
    /**
     * @returns {number}
     */
    now() {
      return clock.time;
    },
    /**
     * @param {number} milliseconds
     * @returns {Promise<void>}
     */
    async sleep(milliseconds) {
      clock.sleeps.push(milliseconds);
      clock.time += milliseconds;
    },
  };
  return clock;
}

/**
 * @param {MemoryBucket} bucket
 * @param {Function} change
 * @returns {Function}
 */
function rewriting(bucket, change) {
  /**
   * @param {string} method
   * @param {string} key
   * @param {object} options
   * @returns {Promise<Response>}
   * @throws {Error}
   */
  return async (method, key, options) => {
    const response = await bucket.transport(method, key, options);
    change(response);
    return response;
  };
}

/**
 * @param {MemoryBucket} bucket
 * @param {object} value
 * @returns {void}
 */
function seedControl(bucket, value) {
  bucket.seed(controlKey, JSON.stringify(value));
}

/**
 * @returns {void}
 */
function ignoreWait() {}

test('a missing control reads as absent and is created only once', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const empty = await store.readControl();
  assert.deepEqual({ ...empty, now: 0 }, { exists: false, head: null, etag: null, savedAt: null, now: 0 });
  assert.ok(Math.abs(empty.now - Date.now()) < 5_000);
  const first = randomUUID();
  assert.equal(await store.setHead(empty, first), true);
  assert.equal(await store.setHead(empty, randomUUID()), false);
  const control = await store.readControl();
  assert.equal(control.exists, true);
  assert.equal(control.head, first);
  assert.match(control.etag, /^"[0-9a-f]{64}"$/);
  assert.equal(control.savedAt, Date.parse(bucket.objects.get(controlKey).lastModified));
  const stored = JSON.parse(bucket.objects.get(controlKey).body);
  assert.deepEqual(Object.keys(stored), ['version', 'change', 'head', 'lease']);
  assert.equal(stored.version, 1);
  assert.equal(stored.lease, null);
  assert.match(stored.change, /^[0-9a-f-]{36}$/);
});

test('compare-and-set loses to a concurrent writer', async () => {
  const bucket = new MemoryBucket();
  const alpha = new CloudStore(bucket.transport);
  const beta = new CloudStore(bucket.transport);
  const base = randomUUID();
  assert.equal(await alpha.setHead(await alpha.readControl(), base), true);
  const alphaView = await alpha.readControl();
  const betaView = await beta.readControl();
  const betaHead = randomUUID();
  assert.equal(await beta.setHead(betaView, betaHead), true);
  assert.equal(await alpha.setHead(alphaView, randomUUID()), false);
  assert.equal((await alpha.readControl()).head, betaHead);
  const rewrite = await beta.readControl();
  assert.equal(await beta.setHead(rewrite, betaHead), true);
  assert.equal(await alpha.setHead(rewrite, betaHead), false);
});

test('a lease left by the old launcher is ignored and cleared on the next head update', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const head = randomUUID();
  seedControl(bucket, { version: 1, change: randomUUID(), head, lease: { owner: randomUUID(), expires: Date.now() + 300_000 } });
  const control = await store.readControl();
  assert.equal(control.head, head);
  seedControl(bucket, { version: 1, change: randomUUID(), head, lease: 'garbage' });
  const garbage = await store.readControl();
  assert.equal(garbage.head, head);
  const next = randomUUID();
  assert.equal(await store.setHead(garbage, next), true);
  assert.deepEqual(JSON.parse(bucket.objects.get(controlKey).body).lease, null);
});

test('a weak, missing or malformed ETag and a missing server date are rejected', async () => {
  const bucket = new MemoryBucket();
  seedControl(bucket, { version: 1, change: randomUUID(), head: null, lease: null });
  for (const etag of ['W/"abc"', 'abc', '"a"b"', '""x', '"tab\there"']) {
    const store = new CloudStore(rewriting(bucket, (response) => response.headers.set('etag', etag)));
    await assert.rejects(store.readControl(), /strong ETag/, etag);
  }
  const unlabeled = new CloudStore(rewriting(bucket, (response) => response.headers.delete('etag')));
  await assert.rejects(unlabeled.readControl(), /strong ETag/);
  const undated = new CloudStore(rewriting(bucket, (response) => response.headers.delete('date')));
  await assert.rejects(undated.readControl(), /valid server date/);
  const badDate = new CloudStore(rewriting(bucket, (response) => response.headers.set('date', 'yesterday')));
  await assert.rejects(badDate.readControl(), /valid server date/);
  const unmodified = new CloudStore(rewriting(bucket, (response) => response.headers.delete('last-modified')));
  await assert.rejects(unmodified.readControl(), /valid Last-Modified date/);
  const badModified = new CloudStore(rewriting(bucket, (response) => response.headers.set('last-modified', 'earlier')));
  await assert.rejects(badModified.readControl(), /valid Last-Modified date/);
  bucket.objects.delete(controlKey);
  await assert.rejects(undated.readControl(), /valid server date/);
});

test('control objects of the wrong shape are rejected', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const shapes = [
    { version: 2, change: randomUUID(), head: null, lease: null },
    { version: 1, change: 'x', head: null, lease: null },
    { version: 1, change: randomUUID(), head: 'x', lease: null },
    { version: 1, change: randomUUID(), lease: null },
    { version: 1, change: randomUUID(), head: randomUUID().toUpperCase(), lease: null },
    null,
    [],
  ];
  for (const shape of shapes) {
    seedControl(bucket, shape);
    await assert.rejects(store.readControl(), /Invalid cloud control object/, JSON.stringify(shape));
  }
  bucket.seed(controlKey, '{"version":1,');
  await assert.rejects(store.readControl(), SyntaxError);
});

test('HTTP failures carry their status', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  bucket.status(controlKey, 403);
  await assert.rejects(store.readControl(), (error) => error.status === 403 && /HTTP 403/.test(error.message));
  bucket.status(controlKey, 503);
  await assert.rejects(store.setHead({ exists: false, etag: null }, randomUUID()), (error) => error.status === 503);
  bucket.status('', 500);
  await assert.rejects(store.hasForeignObjects(), (error) => error.status === 500);
  await assert.rejects(store.blob(hash), (error) => error.status === 404 && error.message.includes(blobKey(hash)));
  bucket.status(controlKey, 409);
  assert.equal(await store.setHead({ exists: false, etag: null }, randomUUID()), false);
  assert.equal(bucket.objects.has(controlKey), false);
});

test('hasForeignObjects ignores Universe objects and finds any other key before or after them under both KeyCount rules', async () => {
  for (const contentsOnly of [false, true]) {
    const bucket = new MemoryBucket();
    bucket.contentsOnlyKeyCount = contentsOnly;
    const store = new CloudStore(bucket.transport);
    assert.equal(await store.hasForeignObjects(), false);
    bucket.seed(blobKey(hash), 'x');
    bucket.seed(manifestKey(randomUUID()), '{}');
    assert.equal(await store.hasForeignObjects(), false);
    for (const foreign of ['legacy/object', 'photos/a.png', 'top-level.txt', '_universe0', '_universe', 'zzz/late', 'A/early']) {
      bucket.seed(foreign, 'x');
      assert.equal(await store.hasForeignObjects(), true, `${foreign} ${contentsOnly}`);
      bucket.objects.delete(foreign);
    }
    assert.equal(await store.hasForeignObjects(), false);
    assert.ok(bucket.requests.every((request) => request.options.list === true && request.options.folders === true));
  }
});

test('hasForeignObjects counts listed elements, ignores KeyCount and refuses a body that is not a bucket listing', async () => {
  /**
   * @param {string} body
   * @returns {CloudStore}
   */
  const listing = (body) => new CloudStore(async () => new Response(body, { headers: { date: new Date().toUTCString() } }));
  const ours = '<CommonPrefixes><Prefix>_universe/</Prefix></CommonPrefixes>';
  const photos = '<CommonPrefixes><Prefix>photos/</Prefix></CommonPrefixes>';
  for (const count of ['<KeyCount>2</KeyCount>', '<KeyCount>0</KeyCount>', '']) {
    assert.equal(await listing(`<ListBucketResult>${count}${ours}${photos}<IsTruncated>false</IsTruncated></ListBucketResult>`).hasForeignObjects(), true, count);
    assert.equal(await listing(`<ListBucketResult>${count}${ours}</ListBucketResult>`).hasForeignObjects(), false, count);
    assert.equal(await listing(`<ListBucketResult>${count}${ours}<Contents><Key>x</Key></Contents></ListBucketResult>`).hasForeignObjects(), true, count);
    assert.equal(await listing(`<ListBucketResult>${count}</ListBucketResult>`).hasForeignObjects(), false, count);
  }
  assert.equal(await listing('<ListBucketResult><CommonPrefixes><Prefix>_universe/v2/</Prefix></CommonPrefixes></ListBucketResult>').hasForeignObjects(), true);
  await assert.rejects(listing('').hasForeignObjects(), /not a bucket listing/);
  await assert.rejects(listing('<Error><Code>Oops</Code></Error>').hasForeignObjects(), /not a bucket listing/);
});

test('the R2 transport keeps the one-key listing by default and lists the root by folder only when asked', async (context) => {
  const fetched = context.mock.method(globalThis, 'fetch', async () => new Response(''));
  const transport = createTransport(readCredentials({
    R2_ACCOUNT_ID: 'testaccount', R2_ACCESS_KEY_ID: 'testkey', R2_SECRET_ACCESS_KEY: 'synthetic', R2_BUCKET: 'test-bucket',
  }));
  await transport('GET', '', { list: true });
  await transport('GET', '', { list: true, folders: true });
  assert.deepEqual(fetched.mock.calls.map((call) => call.arguments[0]), [
    'https://testaccount.r2.cloudflarestorage.com/test-bucket?list-type=2&max-keys=1',
    'https://testaccount.r2.cloudflarestorage.com/test-bucket?delimiter=%2F&list-type=2&max-keys=2',
  ]);
});

test('MemoryBucket keeps the one-key listing without folders and can count KeyCount by Contents only', async () => {
  const bucket = new MemoryBucket();
  bucket.seed('_universe/v2/control.json', '{}');
  bucket.seed('photos/a.png', 'x');
  const plain = await (await bucket.transport('GET', '', { list: true, timeoutMs: 1 })).text();
  assert.equal(plain, '<ListBucketResult><KeyCount>1</KeyCount><Contents><Key>_universe/v2/control.json</Key></Contents></ListBucketResult>');
  bucket.contentsOnlyKeyCount = true;
  const folders = await (await bucket.transport('GET', '', { list: true, folders: true, timeoutMs: 1 })).text();
  assert.match(folders, /^<ListBucketResult><KeyCount>0<\/KeyCount><CommonPrefixes><Prefix>_universe\/<\/Prefix><\/CommonPrefixes><CommonPrefixes><Prefix>photos\/<\/Prefix>/);
});

test('MemoryBucket lists by prefix, token and page size with ISO dates, deletes on DELETE, seeds explicit dates and still refuses unconditional writes', async () => {
  const bucket = new MemoryBucket();
  const at = new Date('2026-10-01T12:34:56Z');
  bucket.seed('p/a', 'a', at);
  bucket.seed('p/b', 'b');
  bucket.seed('q/c', 'c', at);
  assert.equal((await bucket.transport('GET', 'p/a', { timeoutMs: 1 })).headers.get('last-modified'), at.toUTCString());
  bucket.pageSize = 1;
  const first = await (await bucket.transport('GET', '', { list: true, prefix: 'p/', timeoutMs: 1 })).text();
  assert.match(first, /<IsTruncated>true<\/IsTruncated><Contents><Key>p\/a<\/Key><LastModified>2026-10-01T12:34:56\.000Z<\/LastModified>/);
  const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(first)[1];
  const second = await (await bucket.transport('GET', '', { list: true, prefix: 'p/', token, timeoutMs: 1 })).text();
  assert.match(second, /<IsTruncated>false<\/IsTruncated><Contents><Key>p\/b<\/Key><LastModified>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z<\/LastModified>/);
  assert.ok(!second.includes('NextContinuationToken'));
  assert.ok(![first, second].some((page) => page.includes('q/c')));
  assert.equal((await bucket.transport('DELETE', 'p/a', { timeoutMs: 1 })).status, 204);
  assert.equal(bucket.objects.has('p/a'), false);
  await assert.rejects(bucket.transport('DELETE', 'p/b', { match: '"x"', timeoutMs: 1 }), /DELETE with a body or a condition/);
  await assert.rejects(bucket.transport('DELETE', 'p/b', { body: '', timeoutMs: 1 }), /DELETE with a body or a condition/);
  await assert.rejects(bucket.transport('PUT', 'p/b', { body: 'x', timeoutMs: 1 }), /unconditional/);
  assert.equal(bucket.objects.get('p/b').body.toString(), 'b');
});

test('listObjects follows continuation tokens under its prefix only and returns each LastModified in milliseconds', async () => {
  const bucket = new MemoryBucket();
  bucket.pageSize = 2;
  const store = new CloudStore(bucket.transport);
  const folder = '_universe/v2/blobs/';
  const seeded = [
    [blobKey('1'.repeat(64)), new Date('2026-11-01T08:00:00Z')],
    [blobKey('2'.repeat(64)), new Date('2026-11-02T08:00:00Z')],
    [blobKey('3'.repeat(64)), new Date('2026-11-03T08:00:00Z')],
    [blobKey('4'.repeat(64)), new Date('2026-11-04T08:00:00Z')],
    [`${folder}odd & <name> "quoted" 'apostrophe'`, new Date('2026-11-05T08:00:00Z')],
  ];
  for (const [key, at] of seeded) {
    bucket.seed(key, key, at);
  }
  for (const key of [manifestKey(randomUUID()), controlKey, '_universe/v2/blobsx/x', 'photos/a.png']) {
    bucket.seed(key, 'outside the prefix');
  }
  assert.deepEqual(await store.listObjects(folder), seeded.map(([key, at]) => ({ key, lastModified: at.getTime() })));
  const listings = bucket.requests.filter((request) => request.options.list === true);
  assert.equal(listings.length, 3);
  assert.equal(listings[0].options.token, undefined);
  assert.ok(listings.slice(1).every((request) => typeof request.options.token === 'string' && request.options.token.length > 0));
  assert.ok(listings.every((request) => request.method === 'GET' && request.key === '' && request.options.prefix === folder &&
    request.options.timeoutMs === SyncSettings.ControlTimeoutMs && request.options.folders === undefined));
  assert.deepEqual(await new CloudStore(new MemoryBucket().transport).listObjects(folder), []);
});

test('listObjects throws on a body that is not a listing, an entry without a key or a valid LastModified, malformed text, a truncated page without a token and an HTTP failure', async () => {
  const headers = { date: new Date().toUTCString() };
  /**
   * @param {string} inner
   * @returns {string}
   */
  const page = (inner) => `<ListBucketResult><IsTruncated>false</IsTruncated><Contents>${inner}</Contents></ListBucketResult>`;
  const truncated = '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>a</Key><LastModified>2026-11-01T00:00:00Z</LastModified></Contents>' +
    '<NextContinuationToken>next</NextContinuationToken></ListBucketResult>';
  const cases = [
    [['<Error><Code>AccessDenied</Code></Error>'], /not a bucket listing/],
    [[''], /not a bucket listing/],
    [['<ListBucketResult><Contents><Key>a</Key><LastModified>2026-11-01T00:00:00Z</LastModified></Contents></ListBucketResult>'], /not a bucket listing/],
    [['<ListBucketResult><IsTruncated>maybe</IsTruncated></ListBucketResult>'], /not a bucket listing/],
    [['<ListBucketResult><IsTruncated>false</IsTruncated>'], /not a bucket listing/],
    [['<ListBucketResultX><IsTruncated>false</IsTruncated></ListBucketResultX>'], /not a bucket listing/],
    [[page('<LastModified>2026-11-01T00:00:00Z</LastModified>')], /without a key/],
    [[page('<Key></Key><LastModified>2026-11-01T00:00:00Z</LastModified>')], /without a key/],
    [[page('<Key>a</Key>')], /valid LastModified/],
    [[page('<Key>a</Key><LastModified></LastModified>')], /valid LastModified/],
    [[page('<Key>a</Key><LastModified>yesterday</LastModified>')], /valid LastModified/],
    [[page('<Key>a</Key><LastModified>Sun, 01 Nov 2026 00:00:00 GMT</LastModified>')], /valid LastModified/],
    [[page('<Key>a</Key><LastModified>2026-13-45T00:00:00Z</LastModified>')], /valid LastModified/],
    [[page('<Key>a & b</Key><LastModified>2026-11-01T00:00:00Z</LastModified>')], /malformed XML text/],
    [[page('<Key>a&nbsp;b</Key><LastModified>2026-11-01T00:00:00Z</LastModified>')], /malformed XML text/],
    [['<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>'], /truncated without a continuation token/],
    [['<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken></NextContinuationToken></ListBucketResult>'], /truncated without a continuation token/],
    [[truncated, '<Error><Code>InternalError</Code></Error>'], /not a bucket listing/],
    [[truncated, page('<Key>b</Key>')], /valid LastModified/],
  ];
  for (const [bodies, pattern] of cases) {
    const answers = [...bodies];
    const store = new CloudStore(async () => new Response(answers.shift(), { headers }));
    await assert.rejects(store.listObjects('_universe/v2/blobs/'), pattern, bodies.join(' then '));
  }
  const decoded = new CloudStore(async () => new Response(page('<Key>a&#38;b&#x3C;c&gt;d&quot;e&apos;f&lt;</Key><LastModified>2026-11-01T00:00:00.123Z</LastModified>'), { headers }));
  assert.deepEqual(await decoded.listObjects(''), [{ key: 'a&b<c>d"e\'f<', lastModified: Date.parse('2026-11-01T00:00:00.123Z') }]);
  const bucket = new MemoryBucket();
  bucket.status('', 503);
  await assert.rejects(new CloudStore(bucket.transport).listObjects('_universe/v2/blobs/'),
    (error) => error.status === 503 && error.message === 'Cloud listing of _universe/v2/blobs/ failed (HTTP 503).');
});

test('deleteObject counts 200, 204 and 404 as done, throws on anything else, and sends a bare DELETE under the control timeout', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const key = blobKey('e'.repeat(64));
  bucket.seed(key, 'gone soon');
  await store.deleteObject(key);
  assert.equal(bucket.objects.has(key), false);
  for (const code of [200, 204, 404]) {
    bucket.status(key, code);
    await store.deleteObject(key);
  }
  bucket.seed(key, 'kept');
  for (const code of [403, 409, 412, 500, 503]) {
    bucket.status(key, code);
    await assert.rejects(store.deleteObject(key), (error) => error.status === code && error.message === `Cloud delete of ${key} failed (HTTP ${code}).`);
  }
  assert.equal(bucket.objects.has(key), true);
  assert.equal(bucket.requests.length, 9);
  assert.ok(bucket.requests.every((request) => request.method === 'DELETE' && request.key === key &&
    request.options.timeoutMs === SyncSettings.ControlTimeoutMs && request.options.body === undefined &&
    request.options.match === undefined && request.options.absent === undefined));
});

test('blobs are verified on download, checked before upload, and an existing blob is accepted', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const bytes = Buffer.from('chat line');
  await store.putBlob(digest(bytes), bytes);
  assert.deepEqual(await store.blob(digest(bytes)), bytes);
  await store.putBlob(digest(bytes), bytes);
  const puts = bucket.requests.filter((request) => request.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.ok(puts.every((request) => request.options.absent === true && request.options.match === undefined));
  const other = Buffer.from('other');
  bucket.status(blobKey(digest(other)), 409);
  await store.putBlob(digest(other), other);
  bucket.status(blobKey(digest(other)), 500);
  await assert.rejects(store.putBlob(digest(other), other), (error) => error.status === 500);
  const before = bucket.requests.length;
  await assert.rejects(store.putBlob(digest(other), bytes), /do not match/);
  assert.equal(bucket.requests.length, before);
  bucket.seed(blobKey(digest(other)), 'tampered');
  await assert.rejects(store.blob(digest(other)), /integrity check/);
  bucket.seed(blobKey(hash), '');
  await assert.rejects(store.blob(hash), /integrity check/);
});

test('manifests round-trip with sizes and drop out-of-scope entries on read', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const id = randomUUID();
  const parent = randomUUID();
  const files = [
    { path: 'default-user/chats/A/one.jsonl', hash, size: 0, mtimeMs: 5 },
    { path: 'default-user/settings.json', hash: 'b'.repeat(64), size: 9_300_000 },
  ];
  await store.putManifest({ id, parent, files });
  assert.deepEqual(JSON.parse(bucket.objects.get(manifestKey(id)).body), {
    version: 2, id, parent, files: files.map(({ path, hash: fileHash, size }) => ({ path, hash: fileHash, size })),
  });
  assert.deepEqual(await store.manifest(id), {
    id, parent, files: files.map(({ path, hash: fileHash, size }) => ({ path, hash: fileHash, size })),
  });
  const legacy = randomUUID();
  bucket.seed(manifestKey(legacy), JSON.stringify({
    version: 2, id: legacy, parent: null, files: [
      { path: '_webpack', directory: true },
      { path: '_webpack/x.js', hash },
      { path: 'cookie-secret.txt', hash },
      { path: 'default-user', directory: true },
      { path: 'default-user/backups', directory: true },
      { path: 'default-user/backups/s.json', hash },
      { path: 'default-user/settings.json', hash },
    ],
  }));
  assert.deepEqual(await store.manifest(legacy), { id: legacy, parent: null, files: [{ path: 'default-user/settings.json', hash }] });
  const oldFormat = randomUUID();
  bucket.seed(manifestKey(oldFormat), JSON.stringify({ version: 1, id: oldFormat, parent: null, files: [{ path: 'default-user/chats/A/b.jsonl', hash }] }));
  assert.deepEqual((await store.manifest(oldFormat)).files, [{ path: 'default-user/chats/A/b.jsonl', hash }]);
  assert.ok(bucket.requests.filter((request) => request.key.includes('/manifests/')).every((request) => request.options.timeoutMs === SyncSettings.ObjectTimeoutMs));
});

test('a manifest with a traversal path or a bad header throws before returning', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const cases = [
    [{ path: 'default-user/../../../etc/passwd', hash }, /Invalid path in cloud manifest/],
    [{ path: '_webpack/../../x', hash }, /Invalid path in cloud manifest/],
    [{ path: 'default-user\\x.json', hash }, /Invalid path in cloud manifest/],
    [{ path: 'default-user//x.json', hash }, /Invalid path in cloud manifest/],
  ];
  for (const [entry, pattern] of cases) {
    const id = randomUUID();
    bucket.seed(manifestKey(id), JSON.stringify({ version: 2, id, parent: null, files: [{ path: 'a.json', hash }, entry] }));
    await assert.rejects(store.manifest(id), pattern);
  }
  const id = randomUUID();
  const headers = [
    { version: 3, id, parent: null, files: [] },
    { version: 2, id: randomUUID(), parent: null, files: [] },
    { version: 2, id, parent: id, files: [] },
    { version: 2, id, parent: 'x', files: [] },
    { version: 2, id, files: [] },
  ];
  for (const header of headers) {
    bucket.seed(manifestKey(id), JSON.stringify(header));
    await assert.rejects(store.manifest(id), /Invalid cloud manifest/, JSON.stringify(header));
  }
  bucket.seed(manifestKey(id), JSON.stringify({ version: 2, id, parent: null }));
  await assert.rejects(store.manifest(id), /Invalid cloud manifest entries/);
  const before = bucket.requests.length;
  for (const bad of ['../control', '', null, id.toUpperCase()]) {
    await assert.rejects(store.manifest(bad), /Invalid cloud manifest id/);
  }
  assert.equal(bucket.requests.length, before);
});

test('manifestHashes lists the hash of every file entry whatever its path, skips directory entries, and checks the header as manifest does', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const hashes = ['1', '2', '3', '4', '5'].map((digit) => digit.repeat(64));
  const legacy = randomUUID();
  const parent = randomUUID();
  bucket.seed(manifestKey(legacy), JSON.stringify({
    version: 2, id: legacy, parent, files: [
      { path: '_webpack', directory: true },
      { path: '_webpack/bundle.js', hash: hashes[0] },
      { path: 'cookie-secret.txt', hash: hashes[1] },
      { path: 'default-user', directory: true },
      { path: 'default-user/backups', directory: true },
      { path: 'default-user/backups/x.json', hash: hashes[2] },
      { path: 'default-user/settings.json', hash: hashes[3], size: 3 },
      { path: 'default-user/thumbnails/bg.png', hash: hashes[4] },
    ],
  }));
  assert.deepEqual(await store.manifestHashes(legacy), { parent, hashes });
  const oldFormat = randomUUID();
  bucket.seed(manifestKey(oldFormat), JSON.stringify({ version: 1, id: oldFormat, parent: null, files: [{ path: 'default-user/chats/A/b.jsonl', hash }] }));
  assert.deepEqual(await store.manifestHashes(oldFormat), { parent: null, hashes: [hash] });
  const id = randomUUID();
  const headers = [
    { version: 3, id, parent: null, files: [] },
    { version: 2, id: randomUUID(), parent: null, files: [] },
    { version: 2, id, parent: id, files: [] },
    { version: 2, id, parent: 'x', files: [] },
    { version: 2, id, files: [] },
  ];
  for (const header of headers) {
    bucket.seed(manifestKey(id), JSON.stringify(header));
    await assert.rejects(store.manifestHashes(id), /Invalid cloud manifest/, JSON.stringify(header));
  }
  for (const files of [undefined, null, {}, 'files']) {
    bucket.seed(manifestKey(id), JSON.stringify({ version: 2, id, parent: null, files }));
    await assert.rejects(store.manifestHashes(id), { message: `Invalid cloud manifest entries: ${id}` }, JSON.stringify(files));
  }
  const before = bucket.requests.length;
  for (const bad of ['../control', '', null, id.toUpperCase()]) {
    await assert.rejects(store.manifestHashes(bad), /Invalid cloud manifest id/);
  }
  assert.equal(bucket.requests.length, before);
});

test('manifestHashes throws on any entry whose hash is not 64 lowercase hex characters, in or out of the sync scope', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const entries = [
    { path: '_webpack/bundle.js', hash: hash.toUpperCase() },
    { path: 'default-user/backups/x.json', hash: hash.slice(1) },
    { path: 'cookie-secret.txt', hash: `${hash}0` },
    { path: 'default-user/settings.json', hash: 'g'.repeat(64) },
    { path: 'default-user/settings.json' },
    { path: 'default-user/settings.json', hash: 7 },
    { path: 'default-user/settings.json', hash: null },
    { path: 'default-user', directory: true, hash: 'not a hash' },
    { path: 'default-user', directory: false },
    null,
    'default-user/settings.json',
  ];
  for (const entry of entries) {
    const id = randomUUID();
    bucket.seed(manifestKey(id), JSON.stringify({ version: 2, id, parent: null, files: [{ path: 'default-user/a.json', hash }, entry] }));
    await assert.rejects(store.manifestHashes(id), { message: `Invalid blob hash in cloud manifest ${id}: ${JSON.stringify(entry?.path)}` }, JSON.stringify(entry));
  }
});

test('putManifest refuses anything that would poison the cloud, before any request', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const id = randomUUID();
  const good = { path: 'default-user/settings.json', hash, size: 3 };
  const manifests = [
    { id, parent: null, files: [{ path: '_cache/x', hash, size: 1 }] },
    { id, parent: null, files: [{ path: 'default-user/backups/x.json', hash, size: 1 }] },
    { id, parent: null, files: [{ path: 'default-user/settings.json.99', hash, size: 1 }] },
    { id, parent: null, files: [{ path: 'default-user/settings.json', hash, size: null }] },
    { id, parent: null, files: [{ path: 'default-user/settings.json', hash, size: -1 }] },
    { id, parent: null, files: [{ path: 'default-user', directory: true }] },
    { id, parent: null, files: [good, good] },
    { id, parent: id, files: [good] },
    { id, parent: 'x', files: [good] },
    { id: 'x', parent: null, files: [good] },
    { id, parent: null, files: [{ path: '../x', hash, size: 1 }] },
  ];
  for (const manifest of manifests) {
    await assert.rejects(store.putManifest(manifest), /Refusing to upload|Invalid (path|entry) in cloud manifest/, JSON.stringify(manifest));
  }
  assert.equal(bucket.requests.length, 0);
});

test('putManifest omits size for carried-over entries that have none, and the manifest reads back the same', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const id = randomUUID();
  const files = [
    { path: 'default-user/a.json', hash },
    { path: 'default-user/b.json', hash, size: undefined },
    { path: 'default-user/c.json', hash, size: 4 },
  ];
  await store.putManifest({ id, parent: null, files });
  const expected = [{ path: 'default-user/a.json', hash }, { path: 'default-user/b.json', hash }, { path: 'default-user/c.json', hash, size: 4 }];
  assert.deepEqual(JSON.parse(bucket.objects.get(manifestKey(id)).body).files, expected);
  assert.equal(bucket.objects.get(manifestKey(id)).body.includes('"size":null'), false);
  assert.deepEqual((await store.manifest(id)).files, expected);
});

test('setHead refuses a head that is not a manifest id before any request', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const control = await store.readControl();
  const before = bucket.requests.length;
  for (const head of [undefined, null, '', 'not-an-id', randomUUID().toUpperCase(), `${randomUUID()}/x`, 7]) {
    await assert.rejects(store.setHead(control, head), /Invalid cloud head/, String(head));
  }
  assert.equal(bucket.requests.length, before);
  assert.equal(bucket.objects.has(controlKey), false);
});

test('a manifest upload whose reply was lost is accepted on repeat, a different manifest under the same id is not', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const manifest = { id: randomUUID(), parent: null, files: [{ path: 'default-user/a.json', hash, size: 2 }] };
  bucket.loseReplyNext();
  await assert.rejects(store.putManifest(manifest), /fetch failed/);
  assert.ok(bucket.objects.has(manifestKey(manifest.id)));
  await store.putManifest(manifest);
  await assert.rejects(store.putManifest({ ...manifest, files: [{ path: 'default-user/a.json', hash, size: 3 }] }), /different content/);
});

test('a lost reply to a head update still applies the update', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const head = randomUUID();
  await store.readControl();
  bucket.loseReplyNext();
  await assert.rejects(store.setHead(await store.readControl(), head), /fetch failed/);
  assert.equal((await store.readControl()).head, head);
});

test('hasAncestor finds the hundredth ancestor, stops at the hundred-and-first, and stops on a cycle', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const chain = [];
  let parent = null;
  for (let index = 0; index < 150; index += 1) {
    const id = randomUUID();
    bucket.seed(manifestKey(id), JSON.stringify({ version: 2, id, parent, files: [] }));
    chain.unshift(id);
    parent = id;
  }
  assert.equal(await store.hasAncestor(chain[0], chain[1]), true);
  assert.equal(await store.hasAncestor(chain[0], chain[100]), true);
  let before = manifestReads(bucket);
  assert.equal(await store.hasAncestor(chain[0], chain[101]), false);
  assert.equal(manifestReads(bucket) - before, SyncSettings.AncestorLimit);
  assert.equal(await store.hasAncestor(chain[0], chain[0]), false);
  assert.equal(await store.hasAncestor(chain[0], null), false);
  assert.equal(await store.hasAncestor(chain[149], chain[0]), false);
  before = manifestReads(bucket);
  assert.equal(await store.hasAncestor(null, chain[0]), false);
  assert.equal(manifestReads(bucket), before);
  const first = randomUUID();
  const second = randomUUID();
  bucket.seed(manifestKey(first), JSON.stringify({ version: 2, id: first, parent: second, files: [] }));
  bucket.seed(manifestKey(second), JSON.stringify({ version: 2, id: second, parent: first, files: [] }));
  before = manifestReads(bucket);
  assert.equal(await store.hasAncestor(first, randomUUID()), false);
  assert.equal(manifestReads(bucket) - before, 2);
  assert.equal(await store.hasAncestor(first, second), true);
  const orphan = randomUUID();
  bucket.seed(manifestKey(orphan), JSON.stringify({ version: 2, id: orphan, parent: randomUUID(), files: [] }));
  await assert.rejects(store.hasAncestor(orphan, randomUUID()), (error) => error.status === 404);
});

test('each request carries its timeout', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const control = await store.readControl();
  await store.setHead(control, randomUUID());
  await store.hasForeignObjects();
  const bytes = Buffer.from('x');
  await store.putBlob(digest(bytes), bytes);
  await store.blob(digest(bytes));
  const id = randomUUID();
  await store.putManifest({ id, parent: null, files: [] });
  await store.manifest(id);
  await store.manifestHashes(id);
  await store.listObjects('_universe/v2/blobs/');
  await store.deleteObject(blobKey(digest(bytes)));
  const timeouts = bucket.requests.map((request) => [request.method, request.key.split('/').slice(0, 3).join('/'), request.options.timeoutMs]);
  assert.deepEqual(timeouts, [
    ['GET', controlKey, SyncSettings.ControlTimeoutMs],
    ['PUT', controlKey, SyncSettings.ControlTimeoutMs],
    ['GET', '', SyncSettings.ControlTimeoutMs],
    ['PUT', '_universe/v2/blobs', SyncSettings.ObjectTimeoutMs + 1_000],
    ['GET', '_universe/v2/blobs', SyncSettings.ObjectTimeoutMs],
    ['PUT', '_universe/v2/manifests', SyncSettings.ObjectTimeoutMs],
    ['GET', '_universe/v2/manifests', SyncSettings.ObjectTimeoutMs],
    ['GET', '_universe/v2/manifests', SyncSettings.ObjectTimeoutMs],
    ['GET', '', SyncSettings.ControlTimeoutMs],
    ['DELETE', '_universe/v2/blobs', SyncSettings.ControlTimeoutMs],
  ]);
  assert.ok(bucket.requests.every((request) => request.options.signal === undefined));
  await assert.rejects(bucket.transport('GET', controlKey, {}), /without a timeout/);
  await assert.rejects(bucket.transport('PUT', controlKey, { body: 'x', timeoutMs: 1 }), /unconditional/);
});

test('blob timeouts scale with the size, and a size-less download waits for headers, then reads the body by Content-Length', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  assert.equal(SyncSettings.ObjectBytesPerSecond, 25_000);
  const cases = [
    [0, SyncSettings.ObjectTimeoutMs],
    [1, SyncSettings.ObjectTimeoutMs + 1_000],
    [25_000, SyncSettings.ObjectTimeoutMs + 1_000],
    [25_001, SyncSettings.ObjectTimeoutMs + 2_000],
    [250_001, SyncSettings.ObjectTimeoutMs + 11_000],
    [9_300_000, SyncSettings.ObjectTimeoutMs + 372_000],
  ];
  for (const [size, timeoutMs] of cases) {
    const bytes = Buffer.alloc(size, 7);
    await store.putBlob(digest(bytes), bytes);
    assert.equal(bucket.requests.at(-1).options.timeoutMs, timeoutMs, `put ${size}`);
    await store.blob(digest(bytes), size);
    assert.equal(bucket.requests.at(-1).options.timeoutMs, timeoutMs, `get ${size}`);
    assert.equal(bucket.requests.at(-1).options.bodyTimeoutMs, undefined, `get ${size}`);
  }
  const bytes = Buffer.alloc(250_001, 7);
  for (const unknown of [undefined, null, -1, 1.5, '250001']) {
    assert.ok((await store.blob(digest(bytes), unknown)).equals(bytes));
    const { options } = bucket.requests.at(-1);
    assert.equal(options.timeoutMs, SyncSettings.ObjectTimeoutMs, String(unknown));
    assert.equal(options.bodyTimeoutMs('250001'), SyncSettings.ObjectTimeoutMs + 11_000, String(unknown));
  }
  const bodyTimeoutMs = bucket.requests.at(-1).options.bodyTimeoutMs;
  for (const invalid of [null, '', '-1', '1.5', 'abc', '12 34', '99999999999999999999']) {
    assert.equal(bodyTimeoutMs(invalid), SyncSettings.UnknownSizeTimeoutMs, String(invalid));
  }
  assert.equal(bodyTimeoutMs('20000000'), SyncSettings.ObjectTimeoutMs + 800_000);
  bucket.omitContentLength = true;
  const response = await bucket.transport('GET', blobKey(digest(bytes)), { timeoutMs: 1 });
  assert.equal(response.headers.get('content-length'), null);
  assert.ok((await store.blob(digest(bytes))).equals(bytes));
  const tampered = Buffer.from('not the bytes the hash names');
  bucket.seed(blobKey(digest(bytes)), tampered);
  await assert.rejects(store.blob(digest(bytes)), /failed its integrity check/);
  await assert.rejects(bucket.transport('GET', blobKey(digest(bytes)), {
    timeoutMs: 1,
    /**
     * @returns {number}
     */
    bodyTimeoutMs: () => 0,
  }), /Body read without a timeout/);
});

test('an abort during the body read of a size-less blob stops it at once', async () => {
  const bytes = Buffer.from('size-less blob');
  let calls = 0;
  const store = new CloudStore(async (method, key, options) => {
    calls += 1;
    return new Response(new ReadableStream({
      /**
       * @param {ReadableStreamDefaultController} stream
       * @returns {void}
       */
      start(stream) {
        options.signal.addEventListener('abort', () => stream.error(options.signal.reason), { once: true });
      },
    }), { headers: { date: new Date().toUTCString(), 'content-length': String(bytes.length) } });
  });
  const controller = new AbortController();
  const reason = new Error('launcher stopping');
  const reading = store.blob(digest(bytes), null, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  const started = Date.now();
  controller.abort(reason);
  await assert.rejects(reading, (error) => error === reason);
  assert.ok(Date.now() - started < 1_000);
  assert.equal(calls, 1);
});

test('the R2 transport waits for headers under timeoutMs, then gives the body the time bodyTimeoutMs returns, and the caller signal works in both', async (context) => {
  const lengths = [];
  let mode = 'headers hang';
  context.mock.method(globalThis, 'fetch', (input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    if (mode === 'body hangs') {
      resolve(new Response(new ReadableStream({
        /**
         * @param {ReadableStreamDefaultController} stream
         * @returns {void}
         */
        start(stream) {
          init.signal.addEventListener('abort', () => stream.error(init.signal.reason), { once: true });
        },
      }), { headers: { 'content-length': '123' } }));
    }
  }));
  const transport = createTransport(readCredentials({
    R2_ACCOUNT_ID: 'testaccount', R2_ACCESS_KEY_ID: 'testkey', R2_SECRET_ACCESS_KEY: 'synthetic', R2_BUCKET: 'test-bucket',
  }));
  /**
   * @param {?string} length
   * @returns {number}
   */
  const bodyTimeoutMs = (length) => {
    lengths.push(length);
    return 150;
  };
  let started = Date.now();
  await assert.rejects(transport('GET', 'x', { timeoutMs: 20, bodyTimeoutMs }), (error) => error.name === 'TimeoutError');
  assert.ok(Date.now() - started < 140);
  assert.deepEqual(lengths, []);
  mode = 'body hangs';
  started = Date.now();
  const response = await transport('GET', 'x', { timeoutMs: 20, bodyTimeoutMs });
  assert.deepEqual(lengths, ['123']);
  await assert.rejects(response.arrayBuffer(), (error) => error.name === 'TimeoutError');
  assert.ok(Date.now() - started >= 140, 'the header timeout cut the body read');
  const controller = new AbortController();
  const reason = new Error('launcher stopping');
  const pending = await transport('GET', 'x', {
    timeoutMs: 20,
    /**
     * @returns {number}
     */
    bodyTimeoutMs: () => 60_000,
    signal: controller.signal,
  });
  started = Date.now();
  controller.abort(reason);
  await assert.rejects(pending.arrayBuffer(), (error) => error === reason);
  assert.ok(Date.now() - started < 1_000);
});

test('every cloud store method passes the caller signal itself and its timeout to the transport', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const bytes = Buffer.from('x');
  const id = randomUUID();
  await store.putManifest({ id, parent: null, files: [] });
  await store.putBlob(digest(bytes), bytes);
  const control = await store.readControl();
  const calls = [
    (signal) => store.readControl({ signal }),
    (signal) => store.setHead(control, randomUUID(), { signal }),
    (signal) => store.hasForeignObjects({ signal }),
    (signal) => store.manifest(id, { signal }),
    (signal) => store.manifestHashes(id, { signal }),
    (signal) => store.putManifest({ id: randomUUID(), parent: null, files: [] }, { signal }),
    (signal) => store.blob(digest(bytes), 1, { signal }),
    (signal) => store.putBlob(digest(bytes), bytes, { signal }),
    (signal) => store.hasAncestor(id, randomUUID(), { signal }),
    (signal) => store.listObjects('_universe/v2/', { signal }),
    (signal) => store.deleteObject(blobKey(hash), { signal }),
  ];
  for (const call of calls) {
    const controller = new AbortController();
    const reason = new Error('launcher stopping');
    const before = bucket.requests.length;
    await call(controller.signal);
    assert.ok(bucket.requests.length > before);
    assert.ok(bucket.requests.slice(before).every((request) => request.options.signal === controller.signal &&
      Number.isSafeInteger(request.options.timeoutMs)));
    controller.abort(reason);
    const objects = bucket.objects.size;
    await assert.rejects(call(controller.signal), (error) => error === reason, String(call));
    assert.equal(bucket.objects.size, objects);
  }
});

test('the R2 transport aborts after the timeout it is given or when the caller signal aborts', async (context) => {
  context.mock.method(globalThis, 'fetch', (input, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  }));
  const transport = createTransport(readCredentials({
    R2_ACCOUNT_ID: 'testaccount', R2_ACCESS_KEY_ID: 'testkey', R2_SECRET_ACCESS_KEY: 'synthetic', R2_BUCKET: 'test-bucket',
  }));
  const started = Date.now();
  await assert.rejects(transport('GET', controlKey, { timeoutMs: 20 }), (error) => error.name === 'TimeoutError');
  assert.ok(Date.now() - started < 5_000);
  const controller = new AbortController();
  await assert.rejects(transport('GET', controlKey, { timeoutMs: 20, signal: controller.signal }), (error) => error.name === 'TimeoutError');
  const reason = new Error('launcher stopping');
  const pending = transport('GET', controlKey, { timeoutMs: 60_000, signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  await assert.rejects(Retry.run(() => transport('GET', controlKey, { timeoutMs: 5 }), {
    giveUpMs: 3_000, clock: fakeClock(), onWait: ignoreWait,
  }), (error) => error.name === 'TimeoutError');
});

test('Retry survives twenty fetch failures with the planned backoff', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const clock = fakeClock();
  const waits = [];
  bucket.failNext(20);
  const control = await Retry.run(() => store.readControl(), {
    giveUpMs: SyncSettings.TransferGiveUpMs,
    clock,
    /**
     * @param {{attempt: number, error: Error, nextMs: number}} wait
     * @returns {number}
     */
    onWait: (wait) => waits.push(wait),
  });
  assert.equal(control.exists, false);
  assert.equal(waits.length, 20);
  assert.deepEqual(waits.map((wait) => wait.attempt), Array.from(Array(20).keys(), (index) => index + 1));
  assert.ok(waits.every((wait) => wait.error instanceof TypeError && wait.error.message === 'fetch failed' && wait.error.cause instanceof Error));
  assert.deepEqual(clock.sleeps, [1_000, 2_000, 4_000, 8_000, 16_000, ...Array(15).fill(30_000)]);
  assert.deepEqual(waits.map((wait) => wait.nextMs), clock.sleeps);
  assert.equal(bucket.requests.length, 21);
});

test('Retry gives up with the last error once giveUpMs has passed since the first failure, and never sleeps past it', async () => {
  const clock = fakeClock();
  let attempts = 0;
  await assert.rejects(Retry.run(async () => {
    attempts += 1;
    clock.time += 500;
    throw new TypeError(`fetch failed ${attempts}`, { cause: new Error('ECONNRESET') });
  }, { giveUpMs: 100_000, clock, onWait: ignoreWait }), (error) => error.message === `fetch failed ${attempts}`);
  assert.equal(clock.time, 500 + 100_000);
  assert.equal(attempts, clock.sleeps.length);
  const tight = fakeClock();
  let tries = 0;
  await assert.rejects(Retry.run(async () => {
    tries += 1;
    tight.time += 5;
    throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
  }, { giveUpMs: 1, clock: tight, onWait: ignoreWait }), /fetch failed/);
  assert.equal(tries, 1);
  assert.deepEqual(tight.sleeps, [1]);
});

test('every attempt keeps its full timeout, and only the window since the first failure decides whether another starts', async () => {
  const requests = [];
  const clock = fakeClock();
  const store = new CloudStore(async (method, key, options) => {
    requests.push(options);
    clock.time += options.timeoutMs;
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  });
  const controller = new AbortController();
  const attempts = [];
  const big = Buffer.alloc(40_000_000, 7);
  await assert.rejects(Retry.run((attempt) => {
    attempts.push(attempt);
    return store.putBlob(digest(big), big, attempt);
  }, { giveUpMs: SyncSettings.TransferGiveUpMs, clock, signal: controller.signal, onWait: ignoreWait }), { name: 'TimeoutError' });
  const fullMs = SyncSettings.ObjectTimeoutMs + 1_600_000;
  assert.equal(requests.length, 2);
  assert.ok(requests.every((options) => options.timeoutMs === fullMs && options.signal === controller.signal));
  assert.ok(attempts.every((attempt) => Object.keys(attempt).join() === 'signal' && attempt.signal === controller.signal));
  const firstFailure = fullMs;
  assert.ok(clock.time - firstFailure >= SyncSettings.TransferGiveUpMs);
  assert.ok(clock.time - firstFailure <= SyncSettings.TransferGiveUpMs + fullMs);
});

test('a shared window starts at the first failure after the last success, so success elsewhere reopens it and idle time never spends it', async () => {
  const clock = fakeClock();
  const window = { failedAt: null };
  const options = { giveUpMs: 100_000, clock, window, onWait: ignoreWait };
  clock.time += 10_000_000;
  let attempts = 0;
  let reopenedAt = null;
  await assert.rejects(Retry.run(async () => {
    attempts += 1;
    if (attempts === 5) {
      assert.equal(await Retry.run(async () => 'elsewhere', options), 'elsewhere');
      assert.equal(window.failedAt, null);
      reopenedAt = clock.time;
    }
    throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
  }, options), /fetch failed/);
  assert.equal(reopenedAt, 10_000_000 + 15_000);
  assert.equal(window.failedAt, reopenedAt);
  assert.equal(clock.time - reopenedAt, 100_000);
  for (const invalid of [null, 5]) {
    await assert.rejects(Retry.run(async () => {}, { giveUpMs: 1_000, clock, window: invalid, onWait: ignoreWait }), TypeError);
  }
});

test('Retry.retryable accepts network, timeout, 5xx and 429 failures only', () => {
  const network = new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
  const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  for (const error of [network, timeout, Object.assign(new Error('x'), { status: 500 }), Object.assign(new Error('x'), { status: 429 })]) {
    assert.equal(Retry.retryable(error), true, error.message);
  }
  for (const error of [new TypeError('bug'), new SyntaxError('bad json'), Object.assign(new Error('x'), { status: 403 }), new Error('plain')]) {
    assert.equal(Retry.retryable(error), false, error.message);
  }
});

test('Retry refuses a missing or non-positive give-up window and an incomplete clock before any attempt', async () => {
  let calls = 0;
  /**
   * @returns {Promise<void>}
   */
  const operation = async () => {
    calls += 1;
  };
  const invalid = [
    { giveUpMs: undefined, clock: fakeClock() },
    { giveUpMs: 0, clock: fakeClock() },
    { giveUpMs: -1, clock: fakeClock() },
    { giveUpMs: Infinity, clock: fakeClock() },
    { giveUpMs: Number.NaN, clock: fakeClock() },
    { giveUpMs: '1000', clock: fakeClock() },
    { giveUpMs: 1_000, clock: undefined },
    {
      giveUpMs: 1_000,
      clock: {
        /**
         * @returns {number}
         */
        now: () => 0,
      },
    },
    {
      giveUpMs: 1_000,
      clock: {
        /**
         * @returns {Promise<void>}
         */
        sleep: async () => {},
      },
    },
    { giveUpMs: 1_000, clock: Date },
  ];
  for (const options of invalid) {
    await assert.rejects(Retry.run(operation, { ...options, onWait: ignoreWait }), TypeError, String(options.giveUpMs));
  }
  assert.equal(calls, 0);
});

test('Retry retries only network TypeErrors that carry a cause', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  let waits = 0;
  /**
   * @returns {void}
   */
  const countWait = () => {
    waits += 1;
  };
  await assert.rejects(Retry.run(() => store.putBlob(digest('x'), undefined), {
    giveUpMs: SyncSettings.TransferGiveUpMs, clock: fakeClock(), onWait: countWait,
  }), TypeError);
  assert.equal(waits, 0);
  assert.equal(bucket.requests.length, 0);
  let calls = 0;
  const bug = new TypeError('Cannot read properties of undefined');
  await assert.rejects(Retry.run(async () => {
    calls += 1;
    throw bug;
  }, { giveUpMs: SyncSettings.TransferGiveUpMs, clock: fakeClock(), onWait: ignoreWait }), (error) => error === bug);
  assert.equal(calls, 1);
  bucket.failNext(1);
  bucket.loseReplyNext();
  const bytes = Buffer.from('y');
  await Retry.run(() => store.putBlob(digest(bytes), bytes), {
    giveUpMs: SyncSettings.TransferGiveUpMs, clock: fakeClock(), onWait: countWait,
  });
  assert.equal(waits, 2);
  assert.ok(bucket.objects.has(blobKey(digest(bytes))));
});

test('a request aborted by a caller signal that Retry never saw fails at once with zero waits', async (context) => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const controller = new AbortController();
  controller.abort();
  let waits = 0;
  /**
   * @returns {void}
   */
  const countWait = () => {
    waits += 1;
  };
  await assert.rejects(Retry.run(() => store.readControl({ signal: controller.signal }), {
    giveUpMs: SyncSettings.TransferGiveUpMs, clock: fakeClock(), onWait: countWait,
  }), (error) => error.name === 'AbortError');
  assert.equal(waits, 0);
  assert.equal(bucket.requests.length, 1);
  context.mock.method(globalThis, 'fetch', (input, init) => (init.signal.aborted ?
    Promise.reject(init.signal.reason) :
    new Promise(() => {})));
  const viaR2 = new CloudStore(createTransport(readCredentials({
    R2_ACCOUNT_ID: 'testaccount', R2_ACCESS_KEY_ID: 'testkey', R2_SECRET_ACCESS_KEY: 'synthetic', R2_BUCKET: 'test-bucket',
  })));
  await assert.rejects(Retry.run(() => viaR2.readControl({ signal: controller.signal }), {
    giveUpMs: SyncSettings.TransferGiveUpMs, clock: fakeClock(), onWait: countWait,
  }), (error) => error.name === 'AbortError');
  assert.equal(waits, 0);
});

test('Retry ends at once with the caller signal reason before an attempt, during a request and during a wait', async () => {
  const reason = new Error('launcher stopping');
  const aborted = new AbortController();
  aborted.abort(reason);
  let calls = 0;
  await assert.rejects(Retry.run(async () => {
    calls += 1;
  }, { giveUpMs: 1_000, clock: fakeClock(), onWait: ignoreWait, signal: aborted.signal }), (error) => error === reason);
  assert.equal(calls, 0);
  const hanging = new CloudStore((method, key, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason));
  }));
  const during = new AbortController();
  let requests = 0;
  const pending = Retry.run(() => {
    requests += 1;
    return hanging.readControl({ signal: during.signal });
  }, {
    giveUpMs: SyncSettings.TransferGiveUpMs,
    clock: fakeClock(),
    /**
     * @returns {never}
     * @throws {Error}
     */
    onWait: () => assert.fail('retried after the caller aborted'),
    signal: during.signal,
  });
  setImmediate(() => during.abort(reason));
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(requests, 1);
  const waiting = new AbortController();
  const stuck = {
    /**
     * @returns {number}
     */
    now() {
      return 0;
    },
    /**
     * @returns {Promise<void>}
     */
    sleep() {
      setImmediate(() => waiting.abort(reason));
      return new Promise(() => {});
    },
  };
  await assert.rejects(Retry.run(async () => {
    throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
  }, { giveUpMs: 1_000, clock: stuck, onWait: ignoreWait, signal: waiting.signal }), (error) => error === reason);
  const inWait = new AbortController();
  await assert.rejects(Retry.run(async () => {
    throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
  }, {
    giveUpMs: 1_000,
    clock: {
      /**
       * @returns {number}
       */
      now: () => 0,
      /**
       * @returns {Promise<never>}
       */
      sleep: () => new Promise(() => {}),
    },
    /**
     * @returns {void}
     */
    onWait: () => inWait.abort(reason),
    signal: inWait.signal,
  }), (error) => error === reason);
});

test('Retry retries 5xx, 429 and request timeouts but not a 403, a 404 or a validation error', async () => {
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const options = { giveUpMs: SyncSettings.TransferGiveUpMs, clock: fakeClock(), onWait: ignoreWait };
  bucket.status(controlKey, 500);
  bucket.status(controlKey, 503);
  bucket.status(controlKey, 429);
  assert.equal((await Retry.run(() => store.readControl(), options)).exists, false);
  let timeouts = 0;
  assert.equal(await Retry.run(async () => {
    timeouts += 1;
    if (timeouts < 3) {
      throw new DOMException('timed out', 'TimeoutError');
    }
    return 'done';
  }, options), 'done');
  assert.equal(timeouts, 3);
  bucket.status(controlKey, 403);
  for (const [code, operation] of [[403, () => store.readControl()], [404, () => store.blob(hash)]]) {
    let waited = 0;
    const before = bucket.requests.length;
    await assert.rejects(Retry.run(operation, {
      ...options,
      /**
       * @returns {void}
       */
      onWait: () => {
        waited += 1;
      },
    }), (error) => error.status === code);
    assert.equal(waited, 0);
    assert.equal(bucket.requests.length - before, 1);
  }
  for (const thrown of [new Error('Invalid cloud control object.'), new SyntaxError('bad json'),
    new TypeError('fetch failed'), new DOMException('aborted', 'AbortError'), Object.assign(new Error('conflict'), { status: 412 })]) {
    let calls = 0;
    await assert.rejects(Retry.run(async () => {
      calls += 1;
      throw thrown;
    }, options), (error) => error === thrown);
    assert.equal(calls, 1);
  }
});

test('the cloud store clamps every timeout it hands the transport to the Node limit, so a huge Content-Length or size gives a long timeout', async (context) => {
  assert.equal(SyncSettings.MaxTimerMs, 2_147_483_647);
  const bucket = new MemoryBucket();
  const bytes = Buffer.from('clamped');
  bucket.seed(blobKey(digest(bytes)), bytes);
  await new CloudStore(bucket.transport).blob(digest(bytes), 60_000_000_000);
  await new CloudStore(bucket.transport).blob(digest(bytes));
  assert.equal(bucket.requests[0].options.timeoutMs, SyncSettings.MaxTimerMs);
  assert.equal(bucket.requests[1].options.bodyTimeoutMs('60000000000'), SyncSettings.MaxTimerMs);
  assert.equal(bucket.requests[1].options.bodyTimeoutMs('7'), SyncSettings.ObjectTimeoutMs + 1_000);
  const sockets = new Set();
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-length': '60000000000' });
    response.write(Buffer.alloc(1_000, 4));
  });
  server.on('connection', (socket) => sockets.add(socket));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  });
  const realFetch = globalThis.fetch;
  const port = server.address().port;
  const captured = [];
  let loopback = true;
  context.mock.method(globalThis, 'fetch', (url, init) => {
    if (loopback) {
      return realFetch(String(url).replace(/^https:\/\/[^/]+/, `http://127.0.0.1:${port}`), init);
    }
    captured.push(init.signal);
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  });
  const transport = createTransport(readCredentials({
    R2_ACCOUNT_ID: 'testaccount', R2_ACCESS_KEY_ID: 'testkey', R2_SECRET_ACCESS_KEY: 'synthetic', R2_BUCKET: 'test-bucket',
  }));
  const lengths = [];
  const store = new CloudStore((method, key, options) => transport(method, key, {
    ...options,
    /**
     * @param {?string} length
     * @returns {number}
     */
    bodyTimeoutMs: (length) => {
      lengths.push(length);
      return options.bodyTimeoutMs(length);
    },
  }));
  const controller = new AbortController();
  const reason = new Error('the test stopped waiting');
  const reading = store.blob(digest('anything'), null, { signal: controller.signal });
  const outcome = await Promise.race([
    reading.then(() => 'resolved', (error) => error),
    new Promise((resolve) => setTimeout(() => resolve('still reading'), 300)),
  ]);
  assert.equal(outcome, 'still reading');
  assert.deepEqual(lengths, ['60000000000']);
  assert.ok(SyncSettings.ObjectTimeoutMs + 60_000_000_000 / SyncSettings.ObjectBytesPerSecond * 1000 > SyncSettings.MaxTimerMs);
  controller.abort(reason);
  await assert.rejects(reading, (error) => error === reason);
  loopback = false;
  const sized = new CloudStore(transport);
  for (const size of [60_000_000_000, 200_000_000_000]) {
    const stop = new AbortController();
    const pending = sized.blob(digest('anything'), size, { signal: stop.signal });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(captured.length, 1, String(size));
    assert.equal(captured.pop().aborted, false, String(size));
    stop.abort(reason);
    await assert.rejects(pending, (error) => error === reason, String(size));
  }
});

test('r2.mjs imports nothing but node built-ins, so the v5 build can copy it alone', async () => {
  const source = await readFile(new URL('../src/r2.mjs', import.meta.url), 'utf8');
  const specifiers = [...source.matchAll(/\bimport\s*(?:[^'"()]*?\s*from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1] ?? match[2]);
  assert.ok(specifiers.length > 0);
  assert.deepEqual(specifiers.filter((specifier) => !specifier.startsWith('node:')), []);
  assert.ok(!/\bimport\s*\(/.test(source.replace(/\bimport\s*\(\s*['"]node:[^'"]+['"]\s*\)/g, '')));
});
