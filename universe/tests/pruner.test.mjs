import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { digest } from '../src/r2.mjs';
import { CloudStore } from '../src/sync/CloudStore.mjs';
import { Pruner } from '../src/sync/Pruner.mjs';
import { SyncSettings } from '../src/sync/SyncSettings.mjs';
import { MemoryBucket } from './support/MemoryBucket.mjs';

const now = Date.parse('2026-11-23T12:00:00.000Z');
const old = new Date(now - SyncSettings.BlobMinAgeMs - 3_600_000);
const young = new Date(now - 3_600_000);
const controlKey = '_universe/v2/control.json';
const manifestsFolder = '_universe/v2/manifests/';
const blobsFolder = '_universe/v2/blobs/';

/**
 * @param {string} id
 * @returns {string}
 */
function manifestKey(id) {
  return `${manifestsFolder}${id}.json`;
}

/**
 * @param {string} hash
 * @returns {string}
 */
function blobKey(hash) {
  return `${blobsFolder}${hash}`;
}

/**
 * @param {MemoryBucket} bucket
 * @param {?string} parent
 * @param {Record<string, string>} files
 * @param {Date} at
 * @returns {{id: string, hashes: string[]}}
 */
function seedSave(bucket, parent, files, at = old) {
  const id = randomUUID();
  const entries = Object.entries(files).map(([path, content]) => {
    const hash = digest(Buffer.from(content));
    bucket.seed(blobKey(hash), content, at);
    return { path, hash, size: Buffer.byteLength(content) };
  });
  bucket.seed(manifestKey(id), JSON.stringify({ version: 2, id, parent, files: entries }), at);
  return { id, hashes: entries.map((entry) => entry.hash) };
}

/**
 * @param {MemoryBucket} bucket
 * @param {number} count
 * @returns {Array<{id: string, hashes: string[]}>}
 * @throws {TypeError}
 */
function seedChain(bucket, count) {
  const saves = [];
  for (let index = 0; index < count; index += 1) {
    saves.push(seedSave(bucket, saves.at(-1)?.id ?? null, {
      'default-user/settings.json': '{"theme":"dark"}',
      'default-user/chats/Ann/one.jsonl': `{"save":${index}}\n`,
      'default-user/worlds/w.json': `{"world":${Math.floor(index / 10)}}`,
    }));
  }
  bucket.seed(controlKey, JSON.stringify({ version: 1, change: randomUUID(), head: saves.at(-1).id, lease: null }), old);
  return saves;
}

/**
 * @param {MemoryBucket} bucket
 * @param {string} folder
 * @returns {string[]}
 */
function keysUnder(bucket, folder) {
  return [...bucket.objects.keys()].filter((key) => key.startsWith(folder)).sort();
}

/**
 * @param {Array<{id: string, hashes: string[]}>} saves
 * @returns {{manifests: string[], blobs: string[]}}
 */
function keysOf(saves) {
  return {
    manifests: saves.map((save) => manifestKey(save.id)).sort(),
    blobs: [...new Set(saves.flatMap((save) => save.hashes))].map(blobKey).sort(),
  };
}

/**
 * @param {MemoryBucket} bucket
 * @returns {string[]}
 */
function deleted(bucket) {
  return bucket.requests.filter((request) => request.method === 'DELETE').map((request) => request.key);
}

test('150 saves older than a day leave exactly the newest 100 manifests and exactly the blobs they use', async () => {
  const bucket = new MemoryBucket();
  const saves = seedChain(bucket, 150);
  const kept = keysOf(saves.slice(-SyncSettings.KeepSaves));
  const blobsBefore = keysUnder(bucket, blobsFolder).length;
  const result = await Pruner.prune(new CloudStore(bucket.transport), saves.at(-1).id, now);
  assert.deepEqual(keysUnder(bucket, manifestsFolder), kept.manifests);
  assert.deepEqual(keysUnder(bucket, blobsFolder), kept.blobs);
  assert.deepEqual(result, { manifests: 50, blobs: blobsBefore - kept.blobs.length });
  assert.equal(result.blobs, 55);
  assert.ok(bucket.objects.has(controlKey));
  assert.equal(new Set(deleted(bucket)).size, deleted(bucket).length);
  assert.equal(deleted(bucket).length, 105);
  const reads = bucket.requests.filter((request) => request.method === 'GET' && request.key.startsWith(manifestsFolder)).map((request) => request.key);
  assert.deepEqual(reads, saves.slice(-SyncSettings.KeepSaves).reverse().map((save) => manifestKey(save.id)));
});

test('deletes run at most six at a time and in parallel', async () => {
  const bucket = new MemoryBucket();
  const saves = seedChain(bucket, 130);
  let inFlight = 0;
  let most = 0;
  /**
   * @param {string} method
   * @param {string} key
   * @param {object} options
   * @returns {Promise<Response>}
   * @throws {Error}
   */
  const slow = async (method, key, options) => {
    if (method !== 'DELETE') {
      return bucket.transport(method, key, options);
    }
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return bucket.transport(method, key, options);
  };
  assert.deepEqual(await Pruner.prune(new CloudStore(slow), saves.at(-1).id, now), { manifests: 30, blobs: 33 });
  assert.equal(most, SyncSettings.Concurrency);
});

test('an unreferenced blob younger than a day survives, and one exactly a day old is deleted', async () => {
  const bucket = new MemoryBucket();
  const saves = seedChain(bucket, 3);
  const recent = digest(Buffer.from('uploaded an hour ago'));
  const almost = digest(Buffer.from('one second short of a day'));
  const dayOld = digest(Buffer.from('exactly a day old'));
  bucket.seed(blobKey(recent), 'uploaded an hour ago', young);
  bucket.seed(blobKey(almost), 'one second short of a day', new Date(now - SyncSettings.BlobMinAgeMs + 1_000));
  bucket.seed(blobKey(dayOld), 'exactly a day old', new Date(now - SyncSettings.BlobMinAgeMs));
  assert.deepEqual(await Pruner.prune(new CloudStore(bucket.transport), saves.at(-1).id, now), { manifests: 0, blobs: 1 });
  assert.deepEqual(deleted(bucket), [blobKey(dayOld)]);
  assert.ok(bucket.objects.has(blobKey(recent)));
  assert.ok(bucket.objects.has(blobKey(almost)));
});

test('an off-chain manifest of the other PC\'s concurrent save survives while younger than a day and is deleted once older', async () => {
  const bucket = new MemoryBucket();
  const saves = seedChain(bucket, 120);
  const head = saves.at(-1).id;
  const concurrent = seedSave(bucket, head, { 'default-user/settings.json': '{"theme":"the other PC, still uploading"}' }, young);
  const cloud = new CloudStore(bucket.transport);
  assert.deepEqual(await Pruner.prune(cloud, head, now), { manifests: 20, blobs: 22 });
  assert.ok(bucket.objects.has(manifestKey(concurrent.id)));
  assert.ok(bucket.objects.has(blobKey(concurrent.hashes[0])));
  bucket.objects.get(manifestKey(concurrent.id)).lastModified = old.toUTCString();
  assert.deepEqual(await Pruner.prune(cloud, head, now), { manifests: 1, blobs: 0 });
  assert.ok(!bucket.objects.has(manifestKey(concurrent.id)));
  assert.ok(bucket.objects.has(blobKey(concurrent.hashes[0])));
  bucket.objects.get(blobKey(concurrent.hashes[0])).lastModified = old.toUTCString();
  assert.deepEqual(await Pruner.prune(cloud, head, now), { manifests: 0, blobs: 1 });
  assert.deepEqual(keysUnder(bucket, manifestsFolder), keysOf(saves.slice(-SyncSettings.KeepSaves)).manifests);
  assert.deepEqual(keysUnder(bucket, blobsFolder), keysOf(saves.slice(-SyncSettings.KeepSaves)).blobs);
});

test('a chain shorter than 100 stops at its null parent, keeps every save on it and reads nothing past it', async () => {
  const bucket = new MemoryBucket();
  const saves = seedChain(bucket, 5);
  const strays = [
    seedSave(bucket, null, { 'default-user/settings.json': '{"theme":"an unrelated root"}' }),
    seedSave(bucket, saves[2].id, { 'default-user/settings.json': '{"theme":"an abandoned branch"}' }),
  ];
  assert.deepEqual(await Pruner.prune(new CloudStore(bucket.transport), saves.at(-1).id, now), { manifests: 2, blobs: 2 });
  assert.deepEqual(keysUnder(bucket, manifestsFolder), keysOf(saves).manifests);
  assert.deepEqual(keysUnder(bucket, blobsFolder), keysOf(saves).blobs);
  assert.deepEqual(deleted(bucket).sort(), keysOf(strays).manifests.concat(keysOf(strays).blobs).sort());
  const reads = bucket.requests.filter((request) => request.method === 'GET' && request.key.startsWith(manifestsFolder)).map((request) => request.key);
  assert.deepEqual(reads, [...saves].reverse().map((save) => manifestKey(save.id)));
});

test('a parent cycle ends the walk instead of looping, and keeps every manifest on it', async () => {
  const bucket = new MemoryBucket();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const hashes = ids.map((id, index) => {
    const content = `{"cycle":${index}}`;
    const hash = digest(Buffer.from(content));
    bucket.seed(blobKey(hash), content, old);
    bucket.seed(manifestKey(id), JSON.stringify({
      version: 2, id, parent: ids[(index + 1) % ids.length], files: [{ path: 'default-user/settings.json', hash }],
    }), old);
    return hash;
  });
  const stray = seedSave(bucket, null, { 'default-user/settings.json': '{"theme":"stray"}' });
  assert.deepEqual(await Pruner.prune(new CloudStore(bucket.transport), ids[0], now), { manifests: 1, blobs: 1 });
  assert.deepEqual(keysUnder(bucket, manifestsFolder), ids.map(manifestKey).sort());
  assert.deepEqual(keysUnder(bucket, blobsFolder), hashes.map(blobKey).sort());
  assert.ok(!bucket.objects.has(manifestKey(stray.id)));
});

test('listings that span many pages give the same result as one page', async () => {
  const bucket = new MemoryBucket();
  bucket.pageSize = 7;
  const saves = seedChain(bucket, 150);
  const kept = keysOf(saves.slice(-SyncSettings.KeepSaves));
  assert.deepEqual(await Pruner.prune(new CloudStore(bucket.transport), saves.at(-1).id, now), { manifests: 50, blobs: 55 });
  assert.deepEqual(keysUnder(bucket, manifestsFolder), kept.manifests);
  assert.deepEqual(keysUnder(bucket, blobsFolder), kept.blobs);
  const listings = bucket.requests.filter((request) => request.options.list === true);
  assert.equal(listings.length, Math.ceil(150 / 7) + Math.ceil(166 / 7));
  assert.deepEqual(listings.filter((request) => request.options.token === undefined).map((request) => request.options.prefix), [
    manifestsFolder, blobsFolder,
  ]);
});

test('control.json, keys under other prefixes and oddly named keys under the two prefixes are never deleted', async () => {
  const bucket = new MemoryBucket();
  const saves = seedChain(bucket, 2);
  const stray = seedSave(bucket, null, { 'default-user/settings.json': '{"theme":"the only stray"}' });
  const id = randomUUID();
  const hash = digest(Buffer.from('odd'));
  const odd = [
    `${manifestsFolder}${id.toUpperCase()}.json`, `${manifestsFolder}${id}.json.bak`, `${manifestsFolder}${id}`, `${manifestsFolder}${id}.JSON`,
    `${manifestsFolder}sub/${id}.json`, `${manifestsFolder}not-a-uuid.json`, `${manifestsFolder}${id.replaceAll('-', '')}.json`,
    `${manifestsFolder} ${id}.json`, `${manifestsFolder}${id}.json/`, `${blobsFolder}${hash.toUpperCase()}`, `${blobsFolder}${hash.slice(1)}`,
    `${blobsFolder}${hash}0`, `${blobsFolder}${hash}.tmp`, `${blobsFolder}sub/${hash}`, `${blobsFolder}${hash}/`, `${blobsFolder}a & <b>`,
    `_universe/v2/blobsx/${hash}`, `_universe/v2/manifests-old/${id}.json`, `_universe/v1/blobs/${hash}`, `_universe/v1/manifests/${id}.json`,
    `_universe/v2/${hash}`, `_universe/${hash}`, `photos/${hash}`, hash, `${id}.json`,
  ];
  for (const key of odd) {
    bucket.seed(key, 'odd', old);
  }
  assert.deepEqual(await Pruner.prune(new CloudStore(bucket.transport), saves.at(-1).id, now), { manifests: 1, blobs: 1 });
  assert.deepEqual(deleted(bucket).sort(), [blobKey(stray.hashes[0]), manifestKey(stray.id)].sort());
  for (const key of [controlKey, ...odd]) {
    assert.ok(bucket.objects.has(key), key);
  }
});

test('a manifest read failure or a listing failure on any page deletes nothing', async () => {
  const headers = { date: new Date(now).toUTCString() };
  const failures = [
    ['a manifest read', (request, saves) => request.method === 'GET' && request.key === manifestKey(saves[60].id),
      () => new Response(null, { status: 500, headers }), /HTTP 500/],
    ['a manifest listing page', (request) => request.options.prefix === manifestsFolder && request.options.token !== undefined,
      () => new Response('<Error><Code>InternalError</Code></Error>', { headers }), /not a bucket listing/],
    ['the first blob listing page', (request) => request.options.prefix === blobsFolder && request.options.token === undefined,
      () => new Response(null, { status: 503, headers }), /HTTP 503/],
    ['a later blob listing page', (request) => request.options.prefix === blobsFolder && request.options.token !== undefined,
      () => new Response('<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>', { headers }), /truncated without a continuation token/],
    ['a dropped blob listing', (request) => request.options.prefix === blobsFolder,
      () => Promise.reject(new TypeError('fetch failed', { cause: new Error('ECONNRESET') })), /fetch failed/],
  ];
  for (const [label, matches, answer, pattern] of failures) {
    const bucket = new MemoryBucket();
    bucket.pageSize = 7;
    const saves = seedChain(bucket, 150);
    const before = [...bucket.objects.keys()].sort();
    /**
     * @param {string} method
     * @param {string} key
     * @param {object} options
     * @returns {Promise<Response>}
     * @throws {Error}
     */
    const failing = (method, key, options) => (matches({ method, key, options }, saves) ? answer() : bucket.transport(method, key, options));
    await assert.rejects(Pruner.prune(new CloudStore(failing), saves.at(-1).id, now), pattern, label);
    assert.deepEqual(deleted(bucket), [], label);
    assert.deepEqual([...bucket.objects.keys()].sort(), before, label);
  }
});

test('a failed delete rejects with its error after one attempt and starts no delete after it', async () => {
  for (const code of [403, 503]) {
    const bucket = new MemoryBucket();
    const saves = seedChain(bucket, 130);
    const failing = keysOf(saves.slice(0, 30)).manifests[2];
    bucket.status(failing, code);
    /**
     * @param {string} method
     * @param {string} key
     * @param {object} options
     * @returns {Promise<Response>}
     * @throws {Error}
     */
    const slowSuccesses = async (method, key, options) => {
      if (method === 'DELETE' && key !== failing) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      return bucket.transport(method, key, options);
    };
    await assert.rejects(Pruner.prune(new CloudStore(slowSuccesses), saves.at(-1).id, now),
      (error) => error.status === code && error.message === `Cloud delete of ${failing} failed (HTTP ${code}).`);
    assert.equal(deleted(bucket).length, SyncSettings.Concurrency, String(code));
    assert.equal(deleted(bucket).filter((key) => key === failing).length, 1, String(code));
    assert.ok(bucket.objects.has(failing));
    assert.equal(keysUnder(bucket, manifestsFolder).length, 130 - (SyncSettings.Concurrency - 1));
  }
});

test('an aborted signal stops further deletes at once and rejects with its reason, and an aborted start lists and deletes nothing', async () => {
  const bucket = new MemoryBucket();
  const saves = seedChain(bucket, 130);
  const controller = new AbortController();
  const reason = new Error('a save was requested');
  let issued = 0;
  let afterAbort = 0;
  /**
   * @param {string} method
   * @param {string} key
   * @param {object} options
   * @returns {Promise<Response>}
   * @throws {Error}
   */
  const watching = (method, key, options) => {
    if (method === 'DELETE') {
      issued += 1;
      if (controller.signal.aborted) {
        afterAbort += 1;
      }
      if (issued === 8) {
        controller.abort(reason);
      }
    }
    return bucket.transport(method, key, options);
  };
  await assert.rejects(Pruner.prune(new CloudStore(watching), saves.at(-1).id, now, { signal: controller.signal }), (error) => error === reason);
  assert.equal(afterAbort, 0);
  assert.equal(issued, 8);
  assert.equal(keysUnder(bucket, manifestsFolder).length, 130 - 7);
  const before = bucket.requests.length;
  await assert.rejects(Pruner.prune(new CloudStore(bucket.transport), saves.at(-1).id, now, { signal: controller.signal }), (error) => error === reason);
  assert.deepEqual(bucket.requests.slice(before).map((request) => `${request.method} ${request.key}`), [`GET ${manifestKey(saves.at(-1).id)}`]);
});

test('a kept head made before the rewrite keeps the old blobs of its backups, _webpack and cookie-secret.txt entries', async () => {
  const bucket = new MemoryBucket();
  const saves = seedChain(bucket, 3);
  const outOfScope = {
    'default-user/backups/x.json': '{"backup":"made before the rewrite"}',
    '_webpack/bundle.js': 'bundle saved before the rewrite',
    'cookie-secret.txt': 'secret saved before the rewrite',
  };
  const entries = Object.entries(outOfScope).map(([path, content]) => {
    const hash = digest(Buffer.from(content));
    bucket.seed(blobKey(hash), content, old);
    return { path, hash };
  });
  const head = randomUUID();
  bucket.seed(manifestKey(head), JSON.stringify({
    version: 2, id: head, parent: saves.at(-1).id, files: [
      { path: '_webpack', directory: true }, { path: 'default-user', directory: true }, { path: 'default-user/backups', directory: true }, ...entries,
    ],
  }), old);
  const stray = seedSave(bucket, null, { 'default-user/settings.json': '{"theme":"the only stray"}' });
  assert.deepEqual(await Pruner.prune(new CloudStore(bucket.transport), head, now), { manifests: 1, blobs: 1 });
  for (const entry of entries) {
    assert.ok(bucket.objects.has(blobKey(entry.hash)), entry.path);
  }
  assert.deepEqual(deleted(bucket).sort(), [blobKey(stray.hashes[0]), manifestKey(stray.id)].sort());
  assert.deepEqual(keysUnder(bucket, manifestsFolder), [manifestKey(head), ...keysOf(saves).manifests].sort());
});

test('a kept save with an entry whose hash is not 64 lowercase hex fails the cleanup before any listing or delete, in or out of the sync scope', async () => {
  const entries = [
    { path: '_webpack/bundle.js', hash: 'A'.repeat(64) },
    { path: 'cookie-secret.txt' },
    { path: 'default-user/backups/x.json', hash: null },
    { path: 'default-user/settings.json', hash: 'a'.repeat(63) },
  ];
  for (const entry of entries) {
    const bucket = new MemoryBucket();
    const saves = seedChain(bucket, 5);
    const broken = saves[2].id;
    const manifest = JSON.parse(bucket.objects.get(manifestKey(broken)).body.toString());
    bucket.seed(manifestKey(broken), JSON.stringify({ ...manifest, files: [...manifest.files, entry] }), old);
    seedSave(bucket, null, { 'default-user/settings.json': '{"theme":"a stray that stays"}' });
    const before = [...bucket.objects.keys()].sort();
    await assert.rejects(Pruner.prune(new CloudStore(bucket.transport), saves.at(-1).id, now),
      { message: `Invalid blob hash in cloud manifest ${broken}: ${JSON.stringify(entry.path)}` }, entry.path);
    assert.deepEqual(deleted(bucket), [], entry.path);
    assert.ok(bucket.requests.every((request) => request.options.list !== true), entry.path);
    assert.deepEqual([...bucket.objects.keys()].sort(), before, entry.path);
  }
});

test('a cleanup with no current save in the cloud rejects before any request and deletes nothing', async () => {
  const bucket = new MemoryBucket();
  seedChain(bucket, 3);
  seedSave(bucket, null, { 'default-user/settings.json': '{"theme":"a stray that stays"}' });
  const before = [...bucket.objects.keys()].sort();
  await assert.rejects(Pruner.prune(new CloudStore(bucket.transport), null, now), { message: 'The cloud holds no current save.' });
  assert.deepEqual(bucket.requests, []);
  assert.deepEqual([...bucket.objects.keys()].sort(), before);
});
