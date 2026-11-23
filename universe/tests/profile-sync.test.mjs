import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs, { link, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { digest } from '../src/r2.mjs';
import { CloudStore } from '../src/sync/CloudStore.mjs';
import { ProfileSync } from '../src/sync/ProfileSync.mjs';
import { SaveOutcome } from '../src/sync/SaveOutcome.mjs';
import { SaveReason } from '../src/sync/SaveReason.mjs';
import { SyncPhase } from '../src/sync/SyncPhase.mjs';
import { SyncSettings } from '../src/sync/SyncSettings.mjs';
import { MemoryBucket } from './support/MemoryBucket.mjs';

const stoppedPull = 'Stopped before the pull finished. The next start continues it.';
const bucketName = 'account/bucket';
const prefix = '_universe/v2';
const controlKey = `${prefix}/control.json`;
const originalOpen = fs.open;
const originalLstat = fs.lstat;
const originalRename = fs.rename;
const originalRmdir = fs.rmdir;
const foreignMessage = 'The bucket holds other objects but no Universe save, so cloud sync is off.';
const starter = {
  'default-user/settings.json': '{"theme":"dark"}',
  'default-user/chats/Ann/one.jsonl': '{"m":1}\n{"m":2}\n',
  'default-user/characters/Ann.png': 'png-bytes',
  '_storage/user': '{"key":"user","value":{}}',
};

/**
 * @param {number} offsetMs
 * @returns {{time: number, now: Function, sleep: Function}}
 */
function fakeClock(offsetMs = 60_000) {
  const clock = {
    time: Date.now() + offsetMs,
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
      clock.time += milliseconds;
    },
  };
  return clock;
}

/**
 * @param {MemoryBucket} bucket
 * @returns {{down: boolean, before: ?Function, after: ?Function, transport: Function}}
 */
function wire(bucket) {
  const line = {
    down: false,
    before: null,
    after: null,
    /**
     * @param {string} method
     * @param {string} key
     * @param {object} options
     * @returns {Promise<Response>}
     * @throws {Error}
     */
    async transport(method, key, options) {
      await line.before?.(method, key, options);
      if (line.down) {
        throw new TypeError('fetch failed', { cause: new Error('ENETUNREACH') });
      }
      const response = await bucket.request(method, key, options);
      line.after?.(method, key, options);
      return response;
    },
  };
  return line;
}

/**
 * @param {import('node:test').TestContext} context
 * @returns {Promise<string>}
 * @throws {Error}
 */
async function workspace(context) {
  const root = await mkdtemp(join(tmpdir(), 'universe-sync-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * @param {string} root
 * @param {string} name
 * @param {Function} transport
 * @param {object} clock
 * @returns {{sync: ProfileSync, statuses: object[], clock: object, data: string, state: string, conflicts: string}}
 */
function machine(root, name, transport, clock = fakeClock()) {
  const local = join(root, name, 'local');
  const statuses = [];
  const sync = new ProfileSync({
    dataRoot: join(local, 'data'),
    stateRoot: join(local, 'data.universe'),
    bucket: bucketName,
    cloud: new CloudStore(transport),
    clock,
    /**
     * @param {object} status
     * @returns {number}
     */
    onStatus: (status) => statuses.push(status),
  });
  return { sync, statuses, clock, data: join(local, 'data'), state: join(local, 'data.universe'), conflicts: join(local, 'conflicts') };
}

/**
 * @param {string} root
 * @param {Record<string, string>} files
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function put(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

/**
 * @param {string} root
 * @returns {Promise<Record<string, string>>}
 * @throws {Error}
 */
async function tree(root) {
  const found = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const absolute = join(entry.parentPath, entry.name);
      found[absolute.slice(root.length + 1)] = (await readFile(absolute)).toString();
    }
  }
  return found;
}

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 * @throws {Error}
 */
async function folders(root) {
  return (await readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1)).sort();
}

/**
 * @param {MemoryBucket} bucket
 * @param {Record<string, string>} files
 * @param {boolean} sized
 * @returns {Array<{path: string, hash: string, size?: number}>}
 */
function seedFiles(bucket, files, sized = true) {
  return Object.entries(files).map(([path, content]) => {
    const bytes = Buffer.from(content);
    const hash = digest(bytes);
    bucket.seed(`${prefix}/blobs/${hash}`, bytes);
    return sized ? { path, hash, size: bytes.length } : { path, hash };
  });
}

/**
 * @param {MemoryBucket} bucket
 * @param {Array<object>} files
 * @param {?string} parent
 * @param {number} version
 * @returns {string}
 */
function seedManifest(bucket, files, parent = null, version = 2) {
  const id = randomUUID();
  bucket.seed(`${prefix}/manifests/${id}.json`, JSON.stringify({ version, id, parent, files }));
  return id;
}

/**
 * @param {MemoryBucket} bucket
 * @param {string} head
 * @returns {void}
 */
function seedHead(bucket, head) {
  bucket.seed(controlKey, JSON.stringify({ version: 1, change: randomUUID(), head, lease: { owner: 'old launcher', until: 1 } }));
}

/**
 * @param {MemoryBucket} bucket
 * @returns {?string}
 * @throws {Error}
 */
function headOf(bucket) {
  return JSON.parse(bucket.objects.get(controlKey).body.toString()).head;
}

/**
 * @param {MemoryBucket} bucket
 * @returns {Promise<Record<string, string>>}
 * @throws {Error}
 */
async function cloudTree(bucket) {
  const manifest = JSON.parse(bucket.objects.get(`${prefix}/manifests/${headOf(bucket)}.json`).body.toString());
  return Object.fromEntries(manifest.files.map((entry) => [entry.path, bucket.objects.get(`${prefix}/blobs/${entry.hash}`).body.toString()]));
}

/**
 * @param {MemoryBucket} bucket
 * @returns {string[]}
 */
function manifestKeys(bucket) {
  return [...bucket.objects.keys()].filter((key) => key.includes('/manifests/')).sort();
}

/**
 * @param {string} stateRoot
 * @returns {Promise<object>}
 * @throws {Error}
 */
async function syncState(stateRoot) {
  return JSON.parse(await readFile(join(stateRoot, 'sync.json'), 'utf8'));
}

/**
 * @param {{time: number}} clock
 * @param {number} size
 * @param {number} bytesPerSecond
 * @param {{timeoutMs: number}} options
 * @returns {void}
 * @throws {Error}
 */
function slowLink(clock, size, bytesPerSecond, options) {
  const needMs = (size / bytesPerSecond) * 1000;
  if (needMs > options.timeoutMs) {
    clock.time += options.timeoutMs;
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  }
  clock.time += needMs;
}

/**
 * @param {Promise} pending
 * @returns {Promise}
 * @throws {Error}
 */
function settledSoon(pending) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve('still pending after 2 s'), 2_000);
  });
  return Promise.race([pending, late]).finally(() => clearTimeout(timer));
}

/**
 * @param {AbortSignal} signal
 * @returns {Promise<never>}
 * @throws {Error}
 */
function hang(signal) {
  const hung = Promise.withResolvers();
  signal.addEventListener('abort', () => hung.reject(signal.reason), { once: true });
  return hung.promise;
}

/**
 * @param {string} root
 * @param {Function} transport
 * @param {Record<string, string>} files
 * @returns {Promise<object>}
 * @throws {Error}
 */
async function savedMachine(root, transport, files = starter) {
  const first = machine(root, 'a', transport);
  await put(first.data, files);
  assert.deepEqual(await first.sync.start(), { changedFiles: 0, offline: false, disabled: null });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  return first;
}

test('[1] a fresh PC pulls the in-scope cloud files byte for byte, ignores out-of-scope entries, keeps excluded local files and reports full progress', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const inScope = { ...starter, '_css/user.css': 'body{}', 'default-user/chats/backups/kept.jsonl': '{"b":1}\n' };
  const outOfScope = {
    '_webpack/a/b.js': 'bundle', 'default-user/backups/settings_1.json': '{"old":1}', 'cookie-secret.txt': 'cloud-secret',
    'default-user/thumbnails/bg.png': 'thumb', 'default-user/settings.json.12345': 'temp',
  };
  const files = [
    ...seedFiles(bucket, { 'default-user/settings.json': inScope['default-user/settings.json'] }, false),
    ...seedFiles(bucket, Object.fromEntries(Object.entries(inScope).filter(([path]) => path !== 'default-user/settings.json'))),
    ...seedFiles(bucket, outOfScope),
    { path: 'default-user', directory: true },
  ];
  const head = seedManifest(bucket, files);
  seedHead(bucket, head);
  const fresh = machine(root, 'b', bucket.transport);
  const excludedLocal = { '_cache/x.json': '{"local":true}', 'default-user/thumbnails/mine.png': 'my thumb', 'content.log': 'log' };
  await put(fresh.data, excludedLocal);
  const result = await fresh.sync.start();
  assert.deepEqual(result, { changedFiles: Object.keys(inScope).length, offline: false, disabled: null });
  const pulled = await tree(fresh.data);
  const secret = pulled['cookie-secret.txt'];
  delete pulled['cookie-secret.txt'];
  assert.deepEqual(pulled, { ...inScope, ...excludedLocal });
  assert.match(secret, /^[A-Za-z0-9+/]{86}==$/);
  assert.equal((await stat(join(fresh.data, 'cookie-secret.txt'))).mode & 0o777, 0o600);
  const progress = fresh.statuses.map((status) => status.progress).filter((entry) => entry !== null);
  const sizedBytes = Object.entries(inScope).filter(([path]) => path !== 'default-user/settings.json')
    .reduce((sum, [, content]) => sum + Buffer.byteLength(content), 0);
  assert.deepEqual(progress.at(-1), { filesDone: 6, filesTotal: 6, bytesDone: sizedBytes, bytesTotal: sizedBytes });
  assert.deepEqual(progress[0], { filesDone: 0, filesTotal: 6, bytesDone: 0, bytesTotal: sizedBytes });
  assert.equal(fresh.statuses.at(-1).phase, SyncPhase.Running);
  assert.equal(fresh.statuses.at(-1).progress, null);
  assert.equal(fresh.statuses.at(-1).reloadTabs, true);
  const state = await syncState(fresh.state);
  assert.equal(state.revision, head);
  assert.equal(state.pending, null);
  assert.deepEqual(Object.keys(state.files).sort(), Object.keys(inScope).sort());
  await assert.rejects(readdir(fresh.conflicts), { code: 'ENOENT' });
  const before = bucket.requests.length;
  assert.equal((await fresh.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Unchanged);
  assert.deepEqual(bucket.requests.slice(before).map((request) => `${request.method} ${request.key}`), [`GET ${controlKey}`]);
});

test('[2] the 2026-11-22 situation: an old five-folder journal pulls a full-profile head, leaves the cache alone and moves changed files aside', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const oldFiles = { 'default-user/chats/Ann/one.jsonl': '{"m":1}\n', 'default-user/characters/Ann.png': 'png' };
  const oldEntries = seedFiles(bucket, oldFiles, false);
  const old = seedManifest(bucket, oldEntries, null, 1);
  const cloudFiles = { ...oldFiles, 'default-user/chats/Ann/one.jsonl': '{"m":1}\n{"m":2}\n', 'default-user/settings.json': '{"cloud":true}' };
  const head = seedManifest(bucket, [
    { path: '_cache', directory: true }, { path: 'default-user', directory: true },
    ...seedFiles(bucket, cloudFiles),
    ...seedFiles(bucket, { '_webpack/x.js': 'webpack', 'default-user/backups/settings_9.json': '{"backup":1}', '_cache/x.json': '{"cloud":1}' }),
  ], old);
  seedHead(bucket, head);
  const pcOld = machine(root, 'a', bucket.transport);
  await put(pcOld.data, { ...oldFiles, 'default-user/settings.json': '{"local":true}', '_cache/x.json': '{"rebuilt":true}' });
  await mkdir(pcOld.state, { recursive: true });
  await writeFile(join(pcOld.state, 'journal.json'), JSON.stringify({
    version: 3, bucket: bucketName, phase: 'editing', rootId: randomUUID(), base: old, files: oldEntries, format: 1, operation: randomUUID(),
  }));
  const result = await pcOld.sync.start();
  assert.equal(result.offline, false);
  assert.equal(result.disabled, null);
  const local = await tree(pcOld.data);
  delete local['cookie-secret.txt'];
  assert.deepEqual(local, { ...cloudFiles, '_cache/x.json': '{"rebuilt":true}' });
  const [folder] = await readdir(pcOld.conflicts);
  assert.deepEqual(await tree(join(pcOld.conflicts, folder)), { 'default-user/settings.json': '{"local":true}' });
  assert.equal(pcOld.statuses.at(-1).conflictsFolder, join(pcOld.conflicts, folder));
  assert.equal((await syncState(pcOld.state)).revision, head);
});

test('[5] when the other PC saves first the next save reports a conflict without touching anything, and a restart moves changed files aside', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport);
  await put(first.data, { 'cookie-secret.txt': 'old secret' });
  const second = machine(root, 'b', bucket.transport);
  assert.equal((await second.sync.start()).changedFiles, Object.keys(starter).length);
  await put(second.data, { 'default-user/chats/Ann/one.jsonl': '{"m":1}\n{"m":2}\n{"m":"from b"}\n', 'default-user/worlds/w.json': '{"w":1}' });
  assert.equal((await second.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  bucket.objects.get(controlKey).lastModified = 'Tue, 01 Jan 2030 10:00:00 GMT';
  const head = headOf(bucket);
  const firstBefore = await tree(first.data);
  const conflict = await first.sync.save(SaveReason.Timer);
  assert.equal(conflict.outcome, SaveOutcome.Conflict);
  assert.equal(conflict.at, '2030-01-01T10:00:00.000Z');
  assert.equal(conflict.error, "The other PC saved newer changes at 2030-01-01T10:00:00.000Z. This PC's changes stay here. " +
    'Restart Universe to pull; files changed on both PCs go to local/conflicts.');
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Conflict);
  assert.equal(first.statuses.at(-1).conflictAt, conflict.at);
  assert.equal(headOf(bucket), head);
  assert.deepEqual(await tree(first.data), firstBefore);
  await put(first.data, { 'default-user/chats/Ann/one.jsonl': '{"m":"from a"}\n', 'default-user/settings.json': '{"theme":"light!"}' });
  const before = bucket.requests.length;
  assert.deepEqual(await first.sync.save(SaveReason.Manual), conflict);
  assert.equal(bucket.requests.length, before);
  const restarted = machine(root, 'a', bucket.transport);
  const result = await restarted.sync.start();
  assert.equal(result.changedFiles, 3);
  const [folder] = await readdir(restarted.conflicts);
  assert.deepEqual(await tree(join(restarted.conflicts, folder)), {
    'default-user/chats/Ann/one.jsonl': '{"m":"from a"}\n', 'default-user/settings.json': '{"theme":"light!"}',
  });
  const local = await tree(restarted.data);
  assert.notEqual(local['cookie-secret.txt'], 'old secret');
  assert.equal((await stat(join(restarted.data, 'cookie-secret.txt'))).mode & 0o777, 0o600);
  delete local['cookie-secret.txt'];
  assert.deepEqual(local, await cloudTree(bucket));
  assert.equal(headOf(bucket), head);
  assert.equal(restarted.statuses.at(-1).reloadTabs, true);
});

test('[6] an offline start keeps the local files and the first save after the cloud returns reports the newer head as a conflict', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  await savedMachine(root, line.transport);
  const other = machine(root, 'b', bucket.transport);
  await other.sync.start();
  const stateBefore = await readFile(join(root, 'a', 'local', 'data.universe', 'sync.json'), 'utf8');
  line.down = true;
  const offline = machine(root, 'a', line.transport);
  const startedAt = offline.clock.now();
  await put(offline.data, { 'default-user/settings.json': '{"theme":"offline edit"}' });
  assert.deepEqual(await offline.sync.start(), { changedFiles: 0, offline: true, disabled: null });
  const startFinished = new Date(offline.clock.now()).toISOString();
  assert.ok(offline.clock.now() - startedAt >= SyncSettings.StartContactMs);
  assert.equal(offline.statuses.at(-1).phase, SyncPhase.Offline);
  assert.match(offline.statuses.at(-1).error, /^Cloud unreachable: not pulled\. fetch failed$/);
  assert.equal(await readFile(join(offline.state, 'sync.json'), 'utf8'), stateBefore);
  const failed = await offline.sync.save(SaveReason.Timer);
  assert.equal(failed.outcome, SaveOutcome.Failed);
  assert.equal(failed.error, `Not saved since ${startFinished}: fetch failed`);
  assert.equal(offline.statuses.at(-1).phase, SyncPhase.Offline);
  assert.equal(offline.statuses.at(-1).unsavedSince, startFinished);
  await put(other.data, { 'default-user/chats/Ann/two.jsonl': '{"m":"other pc"}\n' });
  assert.equal((await other.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const head = headOf(bucket);
  line.down = false;
  const reconnect = await offline.sync.save(SaveReason.Reconnect);
  assert.equal(reconnect.outcome, SaveOutcome.Conflict);
  assert.equal(headOf(bucket), head);
  assert.equal((await tree(offline.data))['default-user/settings.json'], '{"theme":"offline edit"}');
});

test('[7] a pull that loses the cloud half-way stops start-up, and the rerun converges with nothing lost or moved twice', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const cloudFiles = Object.fromEntries([...Array(14).keys()].map((index) => [`default-user/chats/Ann/c${index}.jsonl`, `{"n":${index}}\n`]));
  const head = seedManifest(bucket, seedFiles(bucket, cloudFiles));
  seedHead(bucket, head);
  const line = wire(bucket);
  let blobReads = 0;
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   */
  line.after = (method, key) => {
    if (key.includes('/blobs/')) {
      blobReads += 1;
      line.down = blobReads >= 4;
    }
  };
  const fresh = machine(root, 'b', line.transport);
  await put(fresh.data, { 'default-user/chats/Ann/c3.jsonl': '{"mine":"edited here"}\n', 'default-user/chats/Ann/local.jsonl': '{"only":"here"}\n' });
  const startedAt = fresh.clock.now();
  await assert.rejects(fresh.sync.start(), /^Error: Pull stopped at default-user\/chats\/Ann\/c\d+\.jsonl: fetch failed$/);
  assert.ok(fresh.clock.now() - startedAt >= SyncSettings.TransferGiveUpMs);
  assert.equal(fresh.statuses.at(-1).phase, SyncPhase.Failed);
  assert.equal(fresh.statuses.at(-1).progress, null);
  await assert.rejects(readFile(join(fresh.state, 'sync.json')), { code: 'ENOENT' });
  const partial = Object.keys(await tree(fresh.data)).filter((path) => path.startsWith('default-user/'));
  assert.ok(partial.length > 1 && partial.length < 15, `partial pull wrote ${partial.length} files`);
  line.down = false;
  line.after = null;
  const rerun = machine(root, 'b', line.transport);
  await rerun.sync.start();
  const local = await tree(rerun.data);
  delete local['cookie-secret.txt'];
  assert.deepEqual(local, { ...cloudFiles, 'default-user/chats/Ann/local.jsonl': '{"only":"here"}\n' });
  const conflictFolders = await readdir(rerun.conflicts);
  assert.equal(conflictFolders.length, 1);
  assert.deepEqual(await tree(join(rerun.conflicts, conflictFolders[0])), { 'default-user/chats/Ann/c3.jsonl': '{"mine":"edited here"}\n' });
  assert.equal((await syncState(rerun.state)).revision, head);
  assert.deepEqual((await readdir(join(rerun.data, 'default-user/chats/Ann'))).filter((name) => /\.\d+$/.test(name)), []);
});

test('[8] a lost reply to the head update still counts as saved, and a crash after it pulls nothing and reports no conflict', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   * @throws {TypeError}
   */
  line.after = (method, key) => {
    if (method === 'PUT' && key === controlKey) {
      line.after = null;
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
    }
  };
  await put(first.data, { 'default-user/settings.json': '{"theme":"lost reply"}' });
  const saved = await first.sync.save(SaveReason.Manual);
  assert.equal(saved.outcome, SaveOutcome.Saved);
  assert.equal((await syncState(first.state)).revision, headOf(bucket));
  assert.equal((await syncState(first.state)).pending, null);
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   * @throws {TypeError}
   */
  line.after = (method, key) => {
    if (method === 'PUT' && key === controlKey) {
      line.down = true;
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
    }
  };
  await put(first.data, { 'default-user/settings.json': '{"theme":"crash after the head moved"}' });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Failed);
  const crashed = await syncState(first.state);
  assert.equal(crashed.pending.id, headOf(bucket));
  assert.notEqual(crashed.revision, headOf(bucket));
  line.down = false;
  line.after = null;
  const restarted = machine(root, 'a', line.transport);
  const blobReadsBefore = bucket.requests.filter((request) => request.key.includes('/blobs/')).length;
  assert.deepEqual(await restarted.sync.start(), { changedFiles: 0, offline: false, disabled: null });
  assert.equal(bucket.requests.filter((request) => request.key.includes('/blobs/')).length, blobReadsBefore);
  await assert.rejects(readdir(restarted.conflicts), { code: 'ENOENT' });
  const state = await syncState(restarted.state);
  assert.equal(state.revision, headOf(bucket));
  assert.equal(state.pending, null);
  assert.equal((await restarted.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Unchanged);
  assert.equal(restarted.statuses.at(-1).conflictAt, null);
});

test('[8] a pending save whose head update landed is recognised by the next save without a restart', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   * @throws {TypeError}
   */
  line.after = (method, key) => {
    if (method === 'PUT' && key === controlKey) {
      line.down = true;
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
    }
  };
  await put(first.data, { 'default-user/settings.json': '{"theme":"landed while offline"}' });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Failed);
  line.down = false;
  line.after = null;
  assert.equal((await first.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Unchanged);
  const state = await syncState(first.state);
  assert.equal(state.revision, headOf(bucket));
  assert.equal(state.pending, null);
});

test('[8] a save that landed before the other PC saved on top records itself as B, and a save that lost the race keeps B and drops its pending manifest on restart', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  const otherFiles = seedFiles(bucket, { ...starter, 'default-user/worlds/other.json': '{"other":1}' });
  let ours = null;
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   * @throws {Error}
   */
  line.after = (method, key) => {
    if (method === 'PUT' && key === controlKey) {
      line.after = null;
      ours = headOf(bucket);
      seedHead(bucket, seedManifest(bucket, otherFiles, ours));
      throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
    }
  };
  await put(first.data, { 'default-user/settings.json': '{"theme":"landed then overtaken"}' });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Conflict);
  let state = await syncState(first.state);
  assert.equal(state.revision, ours);
  assert.equal(state.pending, null);
  const restarted = machine(root, 'a', line.transport);
  assert.equal((await restarted.sync.start()).changedFiles, 2);
  await assert.rejects(readdir(restarted.conflicts), { code: 'ENOENT' });
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   * @throws {Error}
   */
  line.after = (method, key) => {
    if (method === 'PUT' && key.includes('/manifests/')) {
      line.after = null;
      seedHead(bucket, seedManifest(bucket, otherFiles, headOf(bucket)));
    }
  };
  const before = headOf(bucket);
  await put(restarted.data, { 'default-user/settings.json': '{"theme":"lost the race"}' });
  assert.equal((await restarted.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Conflict);
  state = await syncState(restarted.state);
  assert.equal(state.revision, before);
  assert.notEqual(state.pending.id, headOf(bucket));
  const again = machine(root, 'a', line.transport);
  assert.equal((await again.sync.start()).changedFiles, 1);
  assert.equal((await syncState(again.state)).pending, null);
  const [folder] = await readdir(again.conflicts);
  assert.deepEqual(await tree(join(again.conflicts, folder)), { 'default-user/settings.json': '{"theme":"lost the race"}' });
});

test('[9] deletions, renames, a folder replaced by a file and a file replaced by a folder propagate both ways, and a new local-only file survives a pull', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport, {
    ...starter, 'default-user/worlds/w.json': '{"w":1}', 'default-user/x/inner.json': '{"inner":1}', 'default-user/y': 'plain file',
  });
  const second = machine(root, 'b', bucket.transport);
  await second.sync.start();
  await rename(join(first.data, 'default-user/chats/Ann/one.jsonl'), join(first.data, 'default-user/chats/Ann/renamed.jsonl'));
  await unlink(join(first.data, 'default-user/worlds/w.json'));
  await rm(join(first.data, 'default-user/x'), { recursive: true });
  await put(first.data, { 'default-user/x': 'x is a file now' });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  await put(second.data, { 'default-user/notes.json': '{"local only":true}' });
  const secondAgain = machine(root, 'b', bucket.transport);
  await secondAgain.sync.start();
  const pulled = await tree(secondAgain.data);
  delete pulled['cookie-secret.txt'];
  assert.deepEqual(pulled, { ...(await cloudTree(bucket)), 'default-user/notes.json': '{"local only":true}' });
  assert.equal(pulled['default-user/x'], 'x is a file now');
  assert.ok(!(await folders(secondAgain.data)).includes('default-user/worlds'));
  await assert.rejects(readdir(secondAgain.conflicts), { code: 'ENOENT' });
  await rename(join(secondAgain.data, 'default-user/chats/Ann/renamed.jsonl'), join(secondAgain.data, 'default-user/chats/Ann/again.jsonl'));
  await unlink(join(secondAgain.data, 'default-user/y'));
  await put(secondAgain.data, { 'default-user/y/z.json': '{"y is a folder":true}' });
  assert.equal((await secondAgain.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const firstAgain = machine(root, 'a', bucket.transport);
  await firstAgain.sync.start();
  const back = await tree(firstAgain.data);
  delete back['cookie-secret.txt'];
  assert.deepEqual(back, await cloudTree(bucket));
  assert.equal(back['default-user/notes.json'], '{"local only":true}');
  assert.equal(back['default-user/y/z.json'], '{"y is a folder":true}');
  assert.equal(back['default-user/chats/Ann/again.jsonl'], starter['default-user/chats/Ann/one.jsonl']);
  await assert.rejects(readdir(firstAgain.conflicts), { code: 'ENOENT' });
});

test('[9] a local-only file standing where the cloud needs a folder or file is moved aside instead of blocking the pull', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const head = seedManifest(bucket, seedFiles(bucket, { 'default-user/a/b.json': '{"cloud":1}', 'default-user/c': 'cloud file' }));
  seedHead(bucket, head);
  const fresh = machine(root, 'b', bucket.transport);
  await put(fresh.data, { 'default-user/a': 'local file where a folder goes', 'default-user/c/d.json': '{"local":1}' });
  await fresh.sync.start();
  const local = await tree(fresh.data);
  delete local['cookie-secret.txt'];
  assert.deepEqual(local, { 'default-user/a/b.json': '{"cloud":1}', 'default-user/c': 'cloud file' });
  const [folder] = await readdir(fresh.conflicts);
  assert.deepEqual(await tree(join(fresh.conflicts, folder)), { 'default-user/a': 'local file where a folder goes', 'default-user/c/d.json': '{"local":1}' });
});

test('[10] a head manifest with a traversal, backslash or empty-segment path is rejected before any file is touched', async (context) => {
  for (const badPath of ['../escape.json', 'default-user/../../escape.json', 'default-user\\chats\\x.jsonl', 'default-user//x.json', '/etc/passwd']) {
    const root = await workspace(context);
    const bucket = new MemoryBucket();
    const first = await savedMachine(root, bucket.transport);
    await put(first.data, { 'default-user/settings.json': '{"theme":"local edit"}', 'cookie-secret.txt': 'secret' });
    const entries = seedFiles(bucket, { 'default-user/settings.json': '{"theme":"cloud"}' });
    const [evil] = seedFiles(bucket, { 'irrelevant': 'payload' });
    seedHead(bucket, seedManifest(bucket, [...entries, { ...evil, path: badPath }], headOf(bucket)));
    const localBefore = await tree(first.data);
    const stateBefore = await readFile(join(first.state, 'sync.json'), 'utf8');
    const restarted = machine(root, 'a', bucket.transport);
    await assert.rejects(restarted.sync.start(), (error) => error.message.startsWith('Pull stopped at cloud manifest ') &&
      error.message.includes('Invalid path in cloud manifest'), badPath);
    assert.deepEqual(await tree(first.data), localBefore, badPath);
    assert.equal(await readFile(join(first.state, 'sync.json'), 'utf8'), stateBefore, badPath);
    await assert.rejects(readdir(restarted.conflicts), { code: 'ENOENT' }, badPath);
    await assert.rejects(readFile(join(root, 'escape.json')), { code: 'ENOENT' }, badPath);
    assert.equal(restarted.statuses.at(-1).phase, SyncPhase.Failed);
  }
});

test('[11] an emptied data folder with an intact sync.json pulls the cloud copy and never saves a mass deletion', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  const head = headOf(bucket);
  const manifests = manifestKeys(bucket);
  await rm(first.data, { recursive: true });
  await mkdir(first.data);
  const blocked = await first.sync.save(SaveReason.Timer);
  assert.equal(blocked.outcome, SaveOutcome.Blocked);
  assert.equal(blocked.error, 'Not saved: the data folder holds no files.');
  await rm(first.data, { recursive: true });
  line.down = true;
  const offline = machine(root, 'a', line.transport);
  assert.equal((await offline.sync.start()).offline, true);
  line.down = false;
  assert.equal((await offline.sync.save(SaveReason.Reconnect)).outcome, SaveOutcome.Conflict);
  const restarted = machine(root, 'a', line.transport);
  assert.equal((await restarted.sync.start()).changedFiles, Object.keys(starter).length);
  const local = await tree(restarted.data);
  delete local['cookie-secret.txt'];
  assert.deepEqual(local, starter);
  assert.equal((await restarted.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Unchanged);
  assert.equal(headOf(bucket), head);
  assert.deepEqual(manifestKeys(bucket), manifests);
});

test('[12] a file rewritten during the scan, a half-written json, a broken jsonl line, a fresh file and a write-file-atomic temp file never go up', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport);
  const restless = join(first.data, 'default-user/settings.json');
  let rewrites = 0;
  context.mock.method(fs, 'open',
    /**
     * @param {string} path
     * @param {...*} rest
     * @returns {Promise<import('node:fs/promises').FileHandle>}
     * @throws {Error}
     */
    async (path, ...rest) => {
      if (path === restless) {
        rewrites += 1;
        await writeFile(restless, `{"theme":"${'x'.repeat(rewrites)}"}`);
      }
      return originalOpen(path, ...rest);
    });
  const bad = {
    'default-user/worlds/half.json': '{"name":',
    'default-user/chats/Ann/broken.jsonl': '{"m":1}\n{"m":\n',
    'default-user/settings.json.48213': '{"temp":true}',
  };
  await put(first.data, { ...bad, 'default-user/chats/Ann/one.jsonl': '{"m":"a real change"}\n' });
  await put(first.data, { 'default-user/chats/Ann/fresh.jsonl': '{"m":"just written"}\n' });
  const justNow = new Date(first.clock.now() - 500);
  await utimes(join(first.data, 'default-user/chats/Ann/fresh.jsonl'), justNow, justNow);
  await writeFile(restless, '{"theme":"edited before the scan"}');
  const saved = await first.sync.save(SaveReason.Manual);
  assert.equal(saved.outcome, SaveOutcome.Saved);
  context.mock.restoreAll();
  assert.ok(rewrites >= SyncSettings.SettleAttempts);
  const cloud = await cloudTree(bucket);
  assert.deepEqual(cloud, { ...starter, 'default-user/chats/Ann/one.jsonl': '{"m":"a real change"}\n' });
  const blobs = [...bucket.objects.keys()].filter((key) => key.includes('/blobs/'));
  const restlessVersions = ['{"theme":"edited before the scan"}', (await readFile(restless)).toString()];
  for (const content of [...Object.values(bad), ...restlessVersions, '{"m":"just written"}\n']) {
    assert.ok(!blobs.includes(`${prefix}/blobs/${digest(Buffer.from(content))}`), content);
  }
});

test('[12] a local file still being written at start is moved aside, never overwritten as if it matched B', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  await savedMachine(root, bucket.transport);
  const other = machine(root, 'b', bucket.transport);
  await other.sync.start();
  await put(other.data, { 'default-user/settings.json': '{"theme":"other pc"}' });
  assert.equal((await other.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const restarted = machine(root, 'a', bucket.transport);
  await put(restarted.data, { 'default-user/settings.json': '{"theme":"typed a moment ago"}' });
  const justNow = new Date(restarted.clock.now() - 500);
  await utimes(join(restarted.data, 'default-user/settings.json'), justNow, justNow);
  assert.equal((await restarted.sync.start()).changedFiles, 1);
  const [folder] = await readdir(restarted.conflicts);
  assert.deepEqual(await tree(join(restarted.conflicts, folder)), { 'default-user/settings.json': '{"theme":"typed a moment ago"}' });
  assert.equal((await tree(restarted.data))['default-user/settings.json'], '{"theme":"other pc"}');
});

test('a save whose uploads fail for ten minutes leaves the cloud untouched and the next save lands', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  const head = headOf(bucket);
  const manifests = manifestKeys(bucket);
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   */
  line.after = (method, key) => {
    if (method === 'GET' && key === controlKey) {
      line.down = true;
    }
  };
  await put(first.data, { 'default-user/settings.json': '{"theme":"upload fails"}', 'default-user/worlds/w.json': '{"w":"also new"}' });
  const lastSaved = first.statuses.at(-1).lastSavedAt;
  first.clock.time += 5_000;
  const startedAt = first.clock.now();
  const failed = await first.sync.save(SaveReason.Timer);
  assert.equal(failed.outcome, SaveOutcome.Failed);
  assert.equal(failed.error, `Not saved since ${lastSaved}: fetch failed`);
  assert.equal(first.statuses.at(-1).unsavedSince, lastSaved);
  line.down = false;
  first.clock.time += 5_000;
  assert.equal((await first.sync.save(SaveReason.Timer)).error, `Not saved since ${lastSaved}: fetch failed`);
  assert.equal(first.statuses.at(-1).unsavedSince, lastSaved);
  assert.ok(first.clock.now() - startedAt >= SyncSettings.TransferGiveUpMs);
  assert.equal(first.statuses.at(-1).progress, null);
  assert.equal(headOf(bucket), head);
  assert.deepEqual(manifestKeys(bucket), manifests);
  assert.equal((await syncState(first.state)).pending, null);
  line.down = false;
  line.after = null;
  const again = await first.sync.save(SaveReason.Timer);
  assert.equal(again.outcome, SaveOutcome.Saved);
  assert.equal(first.statuses.at(-1).unsavedSince, null);
  assert.equal(first.statuses.at(-1).lastSavedAt, again.at);
  assert.deepEqual(await cloudTree(bucket), { ...starter, 'default-user/settings.json': '{"theme":"upload fails"}', 'default-user/worlds/w.json': '{"w":"also new"}' });
});

test('[13] two pulls in the same second get separate conflicts folders', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  await savedMachine(root, bucket.transport);
  const other = machine(root, 'b', bucket.transport);
  await other.sync.start();
  const clock = fakeClock();
  const stamps = [];
  for (const round of [1, 2]) {
    await put(other.data, { 'default-user/settings.json': `{"other":"${'o'.repeat(round)}"}` });
    assert.equal((await other.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
    const restarted = machine(root, 'a', bucket.transport, clock);
    await put(restarted.data, { 'default-user/settings.json': `{"mine":"${'m'.repeat(round)}"}` });
    await restarted.sync.start();
    stamps.push(restarted.statuses.at(-1).conflictsFolder);
  }
  const stamp = new Date(clock.now()).toISOString().replaceAll(':', '-').replace('.', '-');
  assert.match(stamp, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
  const conflicts = join(root, 'a', 'local', 'conflicts');
  assert.deepEqual(stamps, [join(conflicts, stamp), join(conflicts, `${stamp}-2`)]);
  assert.deepEqual(await tree(join(conflicts, stamp)), { 'default-user/settings.json': '{"mine":"m"}' });
  assert.deepEqual(await tree(join(conflicts, `${stamp}-2`)), { 'default-user/settings.json': '{"mine":"mm"}' });
});

test('[14] an offline migration from a format-2 journal uses journal.files, so the first save is up to date or uploads only the change', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const entries = seedFiles(bucket, starter, false);
  const base = seedManifest(bucket, entries);
  seedHead(bucket, base);
  const journalFiles = [
    { path: '_storage', directory: true }, { path: 'default-user', directory: true }, ...entries,
    ...seedFiles(bucket, { 'default-user/backups/old.json': '{"backup":1}' }, false),
  ].sort((left, right) => (left.path < right.path ? -1 : 1));
  const line = wire(bucket);
  const migrated = machine(root, 'a', line.transport);
  await put(migrated.data, starter);
  await mkdir(migrated.state, { recursive: true });
  await writeFile(join(migrated.state, 'journal.json'), JSON.stringify({
    version: 3, bucket: bucketName, phase: 'clean', rootId: randomUUID(), base, files: journalFiles, format: 2,
  }));
  line.down = true;
  assert.equal((await migrated.sync.start()).offline, true);
  line.down = false;
  let before = bucket.requests.length;
  assert.equal((await migrated.sync.save(SaveReason.Reconnect)).outcome, SaveOutcome.Unchanged);
  assert.deepEqual(bucket.requests.slice(before).map((request) => `${request.method} ${request.key}`), [`GET ${controlKey}`]);
  await put(migrated.data, { 'default-user/settings.json': '{"theme":"after migration"}' });
  before = bucket.requests.length;
  assert.equal((await migrated.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const changedHash = digest(Buffer.from('{"theme":"after migration"}'));
  assert.deepEqual(bucket.requests.slice(before).filter((request) => request.method === 'PUT').map((request) => request.key), [
    `${prefix}/blobs/${changedHash}`, `${prefix}/manifests/${headOf(bucket)}.json`, controlKey,
  ]);
  assert.deepEqual(await cloudTree(bucket), { ...starter, 'default-user/settings.json': '{"theme":"after migration"}' });
});

test('[14] an offline start from a format-1 journal treats B as unknown, so the first save reports a conflict', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const entries = seedFiles(bucket, starter, false);
  const base = seedManifest(bucket, entries, null, 1);
  seedHead(bucket, base);
  const line = wire(bucket);
  const migrated = machine(root, 'a', line.transport);
  await put(migrated.data, starter);
  await mkdir(migrated.state, { recursive: true });
  await writeFile(join(migrated.state, 'journal.json'), JSON.stringify({ version: 2, bucket: bucketName, phase: 'clean', rootId: randomUUID(), base, files: entries }));
  line.down = true;
  assert.equal((await migrated.sync.start()).offline, true);
  line.down = false;
  assert.equal((await migrated.sync.save(SaveReason.Reconnect)).outcome, SaveOutcome.Conflict);
  const online = machine(root, 'a', line.transport);
  assert.deepEqual(await online.sync.start(), { changedFiles: 0, offline: false, disabled: null });
  assert.equal((await syncState(online.state)).revision, base);
});

test('an unchanged save makes exactly one control read, and saves requested during a save queue a single follow-up', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport);
  let before = bucket.requests.length;
  assert.deepEqual(await first.sync.save(SaveReason.Timer), { outcome: SaveOutcome.Unchanged, at: new Date(first.clock.now()).toISOString(), error: null });
  assert.deepEqual(bucket.requests.slice(before).map((request) => `${request.method} ${request.key}`), [`GET ${controlKey}`]);
  await put(first.data, { 'default-user/settings.json': '{"theme":"queued change"}' });
  before = bucket.requests.length;
  const outcomes = await Promise.all([first.sync.save(SaveReason.Timer), first.sync.save(SaveReason.Manual), first.sync.save(SaveReason.Manual), first.sync.save(SaveReason.Stop)]);
  assert.deepEqual(outcomes.map((outcome) => outcome.outcome), [SaveOutcome.Saved, SaveOutcome.Unchanged, SaveOutcome.Unchanged, SaveOutcome.Unchanged]);
  assert.equal(bucket.requests.slice(before).filter((request) => request.key === controlKey && request.method === 'GET').length, 2);
});

test('a bucket mismatch, a case-insensitive probe and a foreign bucket disable sync without touching local files', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const mismatched = machine(root, 'a', bucket.transport);
  await put(mismatched.data, starter);
  await mkdir(mismatched.state, { recursive: true });
  await writeFile(join(mismatched.state, 'sync.json'), JSON.stringify({ bucket: 'other/bucket', revision: null, pending: null, files: {} }));
  const result = await mismatched.sync.start();
  assert.equal(result.disabled, `This PC last synced with bucket other/bucket, not the configured ${bucketName}, so cloud sync is off.`);
  assert.equal(mismatched.statuses.at(-1).phase, SyncPhase.Disabled);
  assert.equal(bucket.requests.length, 0);
  const refused = await mismatched.sync.save(SaveReason.Manual);
  assert.deepEqual(refused, { outcome: SaveOutcome.Blocked, at: refused.at, error: result.disabled });
  assert.equal(bucket.requests.length, 0);
  const folded = machine(root, 'b', bucket.transport);
  await mkdir(folded.state, { recursive: true });
  await writeFile(join(folded.state, 'case-probe'), '');
  await link(join(folded.state, 'case-probe'), join(folded.state, 'CASE-PROBE'));
  assert.match((await folded.sync.start()).disabled, /case-insensitive/);
  assert.equal(bucket.requests.length, 0);
  bucket.seed('someone-else/file.txt', 'not ours');
  const foreign = machine(root, 'c', bucket.transport);
  await put(foreign.data, starter);
  assert.match((await foreign.sync.start()).disabled, /holds other objects/);
  assert.deepEqual(await tree(foreign.data), starter);
  assert.ok(![...bucket.objects.keys()].some((key) => key.startsWith(prefix)));
  const journaled = machine(root, 'd', bucket.transport);
  await mkdir(journaled.state, { recursive: true });
  await writeFile(join(journaled.state, 'journal.json'), JSON.stringify({ version: 3, bucket: 'other/old', base: randomUUID(), files: [], format: 2 }));
  assert.match((await journaled.sync.start()).disabled, /bucket other\/old, not the configured account\/bucket/);
  const corrupt = machine(root, 'e', bucket.transport);
  await mkdir(corrupt.state, { recursive: true });
  await writeFile(join(corrupt.state, 'sync.json'), JSON.stringify({ bucket: bucketName, revision: 'not-an-id', pending: null, files: {} }));
  await assert.rejects(corrupt.sync.start(), /Invalid local sync state/);
});

test('a symbolic link in scope blocks a save and stops a pull, but not a start that pulls nothing', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport);
  await symlink(join(first.data, 'default-user/chats'), join(first.data, 'default-user/linked'));
  const blocked = await first.sync.save(SaveReason.Manual);
  assert.deepEqual(blocked, { outcome: SaveOutcome.Blocked, at: blocked.at, error: 'Save stopped at default-user/linked: not a regular file or folder.' });
  const quiet = machine(root, 'a', bucket.transport);
  assert.deepEqual(await quiet.sync.start(), { changedFiles: 0, offline: false, disabled: null });
  const other = machine(root, 'b', bucket.transport);
  await other.sync.start();
  await put(other.data, { 'default-user/settings.json': '{"theme":"other pc"}' });
  assert.equal((await other.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const before = await tree(first.data);
  await assert.rejects(machine(root, 'a', bucket.transport).sync.start(), /^Error: Pull stopped at default-user\/linked: not a regular file or folder\.$/);
  assert.deepEqual(await tree(first.data), before);
});

test('a file deleted between the scan and its upload read stays deleted on both PCs', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport);
  const target = join(first.data, 'default-user/chats/Ann/one.jsonl');
  await writeFile(target, '{"m":"changed then deleted"}\n');
  await put(first.data, { 'default-user/worlds/w.json': '{"w":1}' });
  let calls = 0;
  context.mock.method(fs, 'lstat',
    /**
     * @param {string} path
     * @param {...*} rest
     * @returns {Promise<import('node:fs').Stats>}
     * @throws {Error}
     */
    async (path, ...rest) => {
      if (path === target) {
        calls += 1;
        if (calls === 3) {
          await rm(target);
        }
      }
      return originalLstat(path, ...rest);
    });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  context.mock.restoreAll();
  assert.ok(calls >= 3);
  const expected = { ...starter, 'default-user/worlds/w.json': '{"w":1}' };
  delete expected['default-user/chats/Ann/one.jsonl'];
  assert.deepEqual(await cloudTree(bucket), expected);
  const second = machine(root, 'b', bucket.transport);
  await second.sync.start();
  await assert.rejects(readFile(join(second.data, 'default-user/chats/Ann/one.jsonl')), { code: 'ENOENT' });
  await put(second.data, { 'default-user/settings.json': '{"theme":"b"}' });
  assert.equal((await second.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const again = machine(root, 'a', bucket.transport);
  await again.sync.start();
  await assert.rejects(readFile(target), { code: 'ENOENT' });
});

test('a file still being written when its upload is read keeps the version B has', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport);
  const target = join(first.data, 'default-user/settings.json');
  await writeFile(target, '{"theme":"scanned version"}');
  let reads = 0;
  context.mock.method(fs, 'open',
    /**
     * @param {string} path
     * @param {...*} rest
     * @returns {Promise<import('node:fs/promises').FileHandle>}
     * @throws {Error}
     */
    async (path, ...rest) => {
      if (path === target) {
        reads += 1;
        if (reads > 1) {
          await writeFile(target, `{"theme":"${'w'.repeat(reads)}"}`);
        }
      }
      return originalOpen(path, ...rest);
    });
  await put(first.data, { 'default-user/worlds/w.json': '{"w":1}' });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  context.mock.restoreAll();
  assert.equal((await cloudTree(bucket))['default-user/settings.json'], starter['default-user/settings.json']);
  assert.equal((await cloudTree(bucket))['default-user/worlds/w.json'], '{"w":1}');
});

test('an interrupted first save leaves only Universe objects, so the restart stays enabled and the next save lands', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = machine(root, 'a', line.transport);
  await put(first.data, starter);
  await first.sync.start();
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   */
  line.after = (method, key) => {
    if (method === 'PUT' && key.includes('/blobs/')) {
      line.down = true;
    }
  };
  assert.equal((await first.sync.save(SaveReason.Stop)).outcome, SaveOutcome.Failed);
  assert.ok([...bucket.objects.keys()].some((key) => key.includes('/blobs/')));
  assert.equal(bucket.objects.has(controlKey), false);
  line.down = false;
  line.after = null;
  const restarted = machine(root, 'a', line.transport);
  assert.deepEqual(await restarted.sync.start(), { changedFiles: 0, offline: false, disabled: null });
  assert.equal((await restarted.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  assert.deepEqual(await cloudTree(bucket), starter);
});

test('a foreign bucket found by a save blocks it for the session, and only network failures at start mean offline', async (context) => {
  const root = await workspace(context);
  const foreign = new MemoryBucket();
  foreign.seed('someone-else/file.txt', 'not ours');
  const line = wire(foreign);
  const offline = machine(root, 'a', line.transport);
  await put(offline.data, starter);
  line.down = true;
  assert.equal((await offline.sync.start()).offline, true);
  line.down = false;
  const blocked = await offline.sync.save(SaveReason.Reconnect);
  assert.deepEqual(blocked, { outcome: SaveOutcome.Blocked, at: blocked.at, error: foreignMessage });
  assert.equal(offline.statuses.at(-1).phase, SyncPhase.Disabled);
  const before = foreign.requests.length;
  assert.equal((await offline.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Blocked);
  assert.equal(foreign.requests.length, before);
  assert.ok(![...foreign.objects.keys()].some((key) => key.startsWith(prefix)));
  const listing = new MemoryBucket();
  listing.seed('someone-else/file.txt', 'not ours');
  listing.status('', 403);
  const refused = machine(root, 'b', listing.transport);
  await put(refused.data, starter);
  assert.deepEqual(await refused.sync.start(), { changedFiles: 0, offline: false, disabled: 'Cloud bucket listing failed (HTTP 403).' });
  assert.ok(!refused.statuses.some((status) => String(status.error).startsWith('Cloud unreachable')));
  assert.equal((await refused.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Blocked);
  assert.ok(![...listing.objects.keys()].some((key) => key.startsWith(prefix)));
  const corrupt = new MemoryBucket();
  corrupt.seed(controlKey, '{"version":1,');
  assert.match((await machine(root, 'c', corrupt.transport).sync.start()).disabled, /JSON/);
  const forbidden = new MemoryBucket();
  forbidden.status(controlKey, 403);
  assert.equal((await machine(root, 'd', forbidden.transport).sync.start()).disabled, 'Cloud control read failed (HTTP 403).');
});

test('[9] a local folder where the cloud has a file is moved aside, and a failed placement leaves no temp file', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  seedHead(bucket, seedManifest(bucket, seedFiles(bucket, { 'default-user/x': 'cloud file', 'default-user/settings.json': '{}' })));
  const fresh = machine(root, 'a', bucket.transport);
  await mkdir(join(fresh.data, 'default-user/x/sub'), { recursive: true });
  assert.equal((await fresh.sync.start()).changedFiles, 2);
  const local = await tree(fresh.data);
  delete local['cookie-secret.txt'];
  assert.deepEqual(local, { 'default-user/x': 'cloud file', 'default-user/settings.json': '{}' });
  const [folder] = await readdir(fresh.conflicts);
  assert.deepEqual(await folders(join(fresh.conflicts, folder)), ['default-user', 'default-user/x', 'default-user/x/sub']);
  const failing = machine(root, 'b', bucket.transport);
  const blockedTarget = join(failing.data, 'default-user/x');
  context.mock.method(fs, 'rename',
    /**
     * @param {string} from
     * @param {string} to
     * @param {...*} rest
     * @returns {Promise<void>}
     * @throws {Error}
     */
    async (from, to, ...rest) => {
      if (to === blockedTarget) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      }
      return originalRename(from, to, ...rest);
    });
  for (const run of [1, 2, 3]) {
    await assert.rejects(machine(root, 'b', bucket.transport).sync.start(), /^Error: Pull stopped at default-user\/x: EACCES/, String(run));
  }
  context.mock.restoreAll();
  const leftovers = (await readdir(join(failing.data, 'default-user'), { recursive: true })).filter((name) => /\.\d+$/.test(name));
  assert.deepEqual(leftovers, []);
});

test('[9] the cloud replacing a folder by a file moves the local folder aside when an empty subfolder keeps it alive', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport, { ...starter, 'default-user/x/inner.json': '{"inner":1}' });
  const second = machine(root, 'b', bucket.transport);
  await second.sync.start();
  await mkdir(join(second.data, 'default-user/x/sub'));
  await rm(join(first.data, 'default-user/x'), { recursive: true });
  await put(first.data, { 'default-user/x': 'x is a file now' });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const restarted = machine(root, 'b', bucket.transport);
  assert.equal((await restarted.sync.start()).changedFiles, 2);
  assert.equal((await tree(restarted.data))['default-user/x'], 'x is a file now');
  const [folder] = await readdir(restarted.conflicts);
  assert.deepEqual(await folders(join(restarted.conflicts, folder)), ['default-user', 'default-user/x', 'default-user/x/sub']);
  assert.equal((await machine(root, 'b', bucket.transport).sync.start()).changedFiles, 0);
});

test('a save that keeps making progress is not cut, and it gives up 600 s after the first failure that follows the last success', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  await put(first.data, { 'default-user/settings.json': '{"theme":"slow"}' });
  let failsLeft = 0;
  let lastKey = null;
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   */
  line.before = (method, key) => {
    if (`${method} ${key}` !== lastKey) {
      lastKey = `${method} ${key}`;
      failsLeft = 20;
    }
    line.down = failsLeft > 0;
    failsLeft -= 1;
  };
  let startedAt = first.clock.now();
  assert.equal((await first.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Saved);
  assert.ok(first.clock.now() - startedAt > 3 * SyncSettings.TransferGiveUpMs);
  const steady = '{"theme":"slow but steady"}';
  const dead = '{"w":"never uploads"}';
  await put(first.data, { 'default-user/settings.json': steady, 'default-user/worlds/w.json': dead });
  const steadyKey = `${prefix}/blobs/${digest(Buffer.from(steady))}`;
  const deadKey = `${prefix}/blobs/${digest(Buffer.from(dead))}`;
  let steadyFailures = 10;
  let lastSuccess = null;
  let firstFailure = null;
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   */
  line.before = (method, key) => {
    line.down = key === deadKey || (key === steadyKey && steadyFailures > 0);
    if (key === steadyKey) {
      steadyFailures -= 1;
    }
    if (line.down) {
      firstFailure ??= first.clock.now();
    }
  };
  /**
   * @returns {void}
   */
  line.after = () => {
    lastSuccess = first.clock.now();
    firstFailure = null;
  };
  startedAt = first.clock.now();
  const failed = await first.sync.save(SaveReason.Timer);
  assert.equal(failed.outcome, SaveOutcome.Failed);
  assert.match(failed.error, /: fetch failed$/);
  assert.ok(lastSuccess > startedAt);
  assert.ok(firstFailure >= lastSuccess);
  assert.ok(first.clock.now() - firstFailure >= SyncSettings.TransferGiveUpMs);
  assert.ok(first.clock.now() - firstFailure <= SyncSettings.TransferGiveUpMs + 30_000);
  assert.ok(first.clock.now() - startedAt > SyncSettings.TransferGiveUpMs + 60_000);
});

test('an abort during a retry wait ends the save at once with no further request', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  await put(first.data, { 'default-user/settings.json': '{"theme":"stopping"}' });
  const controller = new AbortController();
  let calls = 0;
  /**
   * @returns {void}
   */
  line.before = () => {
    calls += 1;
  };
  line.down = true;
  /**
   * @returns {Promise<never>}
   */
  first.clock.sleep = () => {
    controller.abort();
    return new Promise(() => {});
  };
  const result = await settledSoon(first.sync.save(SaveReason.Stop, { signal: controller.signal }));
  assert.deepEqual(result, { outcome: SaveOutcome.Failed, at: result.at, error: 'Stopped before the save finished: fetch failed' });
  assert.equal(calls, 1);
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal((await syncState(first.state)).pending, null);
});

test('a status listener that throws never wedges later saves', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const local = join(root, 'a', 'local');
  await put(join(local, 'data'), starter);
  let throwOnce = true;
  const sync = new ProfileSync({
    dataRoot: join(local, 'data'),
    stateRoot: join(local, 'data.universe'),
    bucket: bucketName,
    cloud: new CloudStore(bucket.transport),
    clock: fakeClock(),
    /**
     * @param {object} status
     * @returns {void}
     * @throws {Error}
     */
    onStatus: (status) => {
      if (status.phase === SyncPhase.Saving && throwOnce) {
        throwOnce = false;
        throw new Error('status sink failed');
      }
    },
  });
  await sync.start();
  const first = await settledSoon(sync.save(SaveReason.Timer));
  assert.equal(first.outcome, SaveOutcome.Failed);
  assert.match(first.error, /: status sink failed$/);
  assert.equal((await settledSoon(sync.save(SaveReason.Manual))).outcome, SaveOutcome.Saved);
});

test('a start that fails before contacting the cloud reports failed', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const broken = machine(root, 'a', bucket.transport);
  await mkdir(broken.state, { recursive: true });
  await writeFile(join(broken.state, 'sync.json'), '{"bucket":"account/bucket","revis');
  await assert.rejects(broken.sync.start(), SyntaxError);
  assert.equal(broken.statuses.at(-1).phase, SyncPhase.Failed);
  assert.match(broken.statuses.at(-1).error, /JSON/);
  assert.equal(bucket.requests.length, 0);
});

test('unchanged saves record the hash time of pulled files, so later scans and restarts read none of them', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  await savedMachine(root, bucket.transport);
  const second = machine(root, 'b', bucket.transport);
  await second.sync.start();
  assert.ok(Object.values((await syncState(second.state)).files).every((entry) => entry.mtimeMs === undefined));
  assert.equal((await second.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Unchanged);
  assert.ok(Object.values((await syncState(second.state)).files).every((entry) => Number.isFinite(entry.mtimeMs) && Number.isFinite(entry.hashedAtMs)));
  const opened = context.mock.method(fs, 'open',
    /**
     * @param {...*} args
     * @returns {Promise<import('node:fs/promises').FileHandle>}
     * @throws {Error}
     */
    (...args) => originalOpen(...args));
  assert.equal((await second.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Unchanged);
  assert.equal((await second.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Unchanged);
  await machine(root, 'b', bucket.transport).sync.start();
  assert.deepEqual(opened.mock.calls.map((call) => String(call.arguments[0])).filter((path) => path.startsWith(`${second.data}/`)), []);
  assert.ok(opened.mock.calls.length > 0);
});

test('[12] an unsettled local file whose cloud entry still equals B stays in place untouched and goes up once settled', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  await savedMachine(root, bucket.transport);
  const other = machine(root, 'b', bucket.transport);
  await other.sync.start();
  await put(other.data, { 'default-user/worlds/new.json': '{"new":1}' });
  assert.equal((await other.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const restarted = machine(root, 'a', bucket.transport);
  await put(restarted.data, { 'default-user/settings.json': '{"theme":"typed a moment ago"}' });
  const justNow = new Date(restarted.clock.now() - 500);
  await utimes(join(restarted.data, 'default-user/settings.json'), justNow, justNow);
  assert.equal((await restarted.sync.start()).changedFiles, 1);
  assert.equal((await tree(restarted.data))['default-user/settings.json'], '{"theme":"typed a moment ago"}');
  await assert.rejects(readdir(restarted.conflicts), { code: 'ENOENT' });
  restarted.clock.time += 5_000;
  assert.equal((await restarted.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  assert.equal((await cloudTree(bucket))['default-user/settings.json'], '{"theme":"typed a moment ago"}');
});

test('a stop joining a queued save makes the follow-up a stop that ends in phase stopped, failures included', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  await put(first.data, { 'default-user/settings.json': '{"theme":"before stopping"}' });
  const outcomes = await Promise.all([first.sync.save(SaveReason.Timer), first.sync.save(SaveReason.Timer), first.sync.save(SaveReason.Stop)]);
  assert.deepEqual(outcomes.map((outcome) => outcome.outcome), [SaveOutcome.Saved, SaveOutcome.Unchanged, SaveOutcome.Unchanged]);
  assert.ok(first.statuses.some((status) => status.phase === SyncPhase.Stopping));
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
  line.down = true;
  await put(first.data, { 'default-user/settings.json': '{"theme":"network down at stop"}' });
  const failed = await first.sync.save(SaveReason.Stop);
  assert.equal(failed.outcome, SaveOutcome.Failed);
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(first.statuses.at(-1).error, failed.error);
  line.down = false;
  const other = machine(root, 'b', line.transport);
  await other.sync.start();
  await put(other.data, { 'default-user/worlds/w.json': '{"w":1}' });
  assert.equal((await other.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  assert.equal((await first.sync.save(SaveReason.Timer)).outcome, SaveOutcome.Conflict);
  const before = bucket.requests.length;
  const conflict = await first.sync.save(SaveReason.Stop);
  assert.equal(conflict.outcome, SaveOutcome.Conflict);
  assert.equal(bucket.requests.length, before);
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(first.statuses.at(-1).error, conflict.error);
});

test('a stop signal given while a save runs aborts its in-flight request at once and the stop makes no request', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  await put(first.data, { 'default-user/settings.json': '{"theme":"in flight"}' });
  let calls = 0;
  /**
   * @param {string} method
   * @param {string} key
   * @param {{signal: AbortSignal}} options
   * @returns {Promise<never>}
   * @throws {Error}
   */
  line.before = (method, key, options) => {
    calls += 1;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  };
  const controller = new AbortController();
  const timer = first.sync.save(SaveReason.Timer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  const stop = first.sync.save(SaveReason.Stop, { signal: controller.signal });
  controller.abort();
  const results = await settledSoon(Promise.all([timer, stop]));
  assert.notEqual(results, 'still pending after 2 s');
  assert.deepEqual(results.map((result) => [result.outcome, result.error]), [
    [SaveOutcome.Failed, 'Stopped before the save finished.'], [SaveOutcome.Failed, 'Stopped before the save finished.'],
  ]);
  assert.equal(calls, 1);
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
});

test('a stop signal given while a save waits between retries ends that wait at once with no further request', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  await put(first.data, { 'default-user/settings.json': '{"theme":"waiting"}' });
  let afterAbort = 0;
  const controller = new AbortController();
  /**
   * @returns {void}
   */
  line.before = () => {
    if (controller.signal.aborted) {
      afterAbort += 1;
    }
  };
  line.down = true;
  /**
   * @returns {Promise<never>}
   */
  first.clock.sleep = () => new Promise(() => {});
  const timer = first.sync.save(SaveReason.Timer);
  const stop = first.sync.save(SaveReason.Stop, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const results = await settledSoon(Promise.all([timer, stop]));
  assert.notEqual(results, 'still pending after 2 s');
  assert.deepEqual(results.map((result) => result.error), [
    'Stopped before the save finished: fetch failed', 'Stopped before the save finished: fetch failed',
  ]);
  assert.equal(afterAbort, 0);
});

test('a stop that runs out of budget while its own request hangs names no failure left over from start or an earlier save', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  await savedMachine(root, line.transport);
  line.down = true;
  const restarted = machine(root, 'a', line.transport);
  await put(restarted.data, { 'default-user/settings.json': '{"theme":"edited offline"}' });
  assert.equal((await restarted.sync.start()).offline, true);
  line.down = false;
  /**
   * @returns {Promise<object>}
   * @throws {Error}
   */
  const stopWhileRequestHangs = async () => {
    const inFlight = Promise.withResolvers();
    /**
     * @param {string} method
     * @param {string} key
     * @param {{signal: AbortSignal}} options
     * @returns {Promise<never>}
     * @throws {Error}
     */
    line.before = (method, key, options) => {
      inFlight.resolve(`${method} ${key}`);
      return hang(options.signal);
    };
    const controller = new AbortController();
    const stopping = restarted.sync.save(SaveReason.Stop, { signal: controller.signal });
    assert.equal(await inFlight.promise, `GET ${controlKey}`);
    controller.abort();
    const result = await settledSoon(stopping);
    line.before = null;
    return result;
  };
  const afterStart = await stopWhileRequestHangs();
  assert.deepEqual([afterStart.outcome, afterStart.error], [SaveOutcome.Failed, 'Stopped before the save finished.']);
  line.down = true;
  const failed = await restarted.sync.save(SaveReason.Timer);
  assert.equal(failed.outcome, SaveOutcome.Failed);
  assert.match(failed.error, /^Not saved since .+: fetch failed$/);
  line.down = false;
  const afterFailedSave = await stopWhileRequestHangs();
  assert.deepEqual([afterFailedSave.outcome, afterFailedSave.error], [SaveOutcome.Failed, 'Stopped before the save finished.']);
  assert.equal(restarted.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(restarted.statuses.at(-1).error, 'Stopped before the save finished.');
});

test('a timer save that gives up hands no failure to its queued follow-ups, so a manual save and a stop stopped while its request hangs name no cause', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  await put(first.data, { 'default-user/settings.json': '{"theme":"edited while the network is down"}' });
  const manualInFlight = Promise.withResolvers();
  /**
   * @param {string} method
   * @param {string} key
   * @param {{signal: AbortSignal}} options
   * @returns {?Promise<never>}
   * @throws {Error}
   */
  line.before = (method, key, options) => {
    if (!first.statuses.some((status) => status.error?.startsWith('Not saved since '))) {
      return null;
    }
    line.down = false;
    manualInFlight.resolve(`${method} ${key}`);
    return hang(options.signal);
  };
  line.down = true;
  const timer = first.sync.save(SaveReason.Timer);
  const manual = first.sync.save(SaveReason.Manual);
  const gaveUp = await timer;
  assert.equal(gaveUp.outcome, SaveOutcome.Failed);
  assert.match(gaveUp.error, /^Not saved since .+: fetch failed$/);
  assert.equal(await manualInFlight.promise, `GET ${controlKey}`);
  const controller = new AbortController();
  const stop = first.sync.save(SaveReason.Stop, { signal: controller.signal });
  controller.abort();
  const results = await settledSoon(Promise.all([manual, stop]));
  assert.notEqual(results, 'still pending after 2 s');
  assert.deepEqual(results.map((result) => [result.outcome, result.error]), [
    [SaveOutcome.Failed, 'Stopped before the save finished.'], [SaveOutcome.Failed, 'Stopped before the save finished.'],
  ]);
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(first.statuses.at(-1).error, 'Stopped before the save finished.');
});

test('a stopped save with nothing queued behind it hands its failure to no later save, so a later stop stopped while its request hangs names no cause', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  await put(first.data, { 'default-user/settings.json': '{"theme":"edited while the network is down"}' });
  const retryWait = Promise.withResolvers();
  /**
   * @returns {Promise<never>}
   */
  first.clock.sleep = () => {
    retryWait.resolve();
    return new Promise(() => {});
  };
  line.down = true;
  const firstController = new AbortController();
  const firstStop = first.sync.save(SaveReason.Stop, { signal: firstController.signal });
  await retryWait.promise;
  firstController.abort();
  const firstResult = await settledSoon(firstStop);
  assert.notEqual(firstResult, 'still pending after 2 s');
  assert.deepEqual([firstResult.outcome, firstResult.error], [SaveOutcome.Failed, 'Stopped before the save finished: fetch failed']);
  line.down = false;
  const readInFlight = Promise.withResolvers();
  /**
   * @param {string} method
   * @param {string} key
   * @param {{signal: AbortSignal}} options
   * @returns {Promise<never>}
   * @throws {Error}
   */
  line.before = (method, key, options) => {
    readInFlight.resolve(`${method} ${key}`);
    return hang(options.signal);
  };
  const secondController = new AbortController();
  const secondStop = first.sync.save(SaveReason.Stop, { signal: secondController.signal });
  assert.equal(await readInFlight.promise, `GET ${controlKey}`);
  secondController.abort();
  const secondResult = await settledSoon(secondStop);
  assert.notEqual(secondResult, 'still pending after 2 s');
  assert.deepEqual([secondResult.outcome, secondResult.error], [SaveOutcome.Failed, 'Stopped before the save finished.']);
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(first.statuses.at(-1).error, 'Stopped before the save finished.');
});

test('a stop with one upload waiting to retry names that failure even after a parallel upload succeeds', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  const failing = '{"theme":"upload that fails"}';
  const succeeding = '{"m":"upload that succeeds"}\n';
  await put(first.data, { 'default-user/settings.json': failing, 'default-user/chats/Ann/one.jsonl': succeeding });
  const retryWait = Promise.withResolvers();
  /**
   * @returns {Promise<never>}
   */
  first.clock.sleep = () => {
    retryWait.resolve();
    return new Promise(() => {});
  };
  let failures = 0;
  /**
   * @param {string} method
   * @param {string} key
   * @returns {Promise<void>}
   * @throws {TypeError}
   */
  line.before = async (method, key) => {
    if (method === 'PUT' && key === `${prefix}/blobs/${digest(failing)}`) {
      failures += 1;
      throw new TypeError('fetch failed', { cause: new Error('ENETUNREACH') });
    }
    if (method === 'PUT' && key === `${prefix}/blobs/${digest(succeeding)}`) {
      await retryWait.promise;
    }
  };
  const controller = new AbortController();
  const marker = first.statuses.length;
  const stopping = first.sync.save(SaveReason.Stop, { signal: controller.signal });
  const deadline = Date.now() + 2_000;
  while (!first.statuses.slice(marker).some((status) => status.progress?.filesDone === 1)) {
    assert.ok(Date.now() < deadline, 'the second upload never finished');
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(failures, 1);
  assert.ok(bucket.objects.has(`${prefix}/blobs/${digest(succeeding)}`));
  controller.abort();
  const result = await settledSoon(stopping);
  assert.deepEqual([result.outcome, result.error], [SaveOutcome.Failed, 'Stopped before the save finished: fetch failed']);
  assert.equal(failures, 1);
  assert.equal(bucket.objects.has(`${prefix}/blobs/${digest(failing)}`), false);
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(first.statuses.at(-1).error, 'Stopped before the save finished: fetch failed');
});

test('a save that still ends saved when the stop signal comes after its head update hands no failure to the queued stop', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  const edited = '{"theme":"saved just before the stop"}';
  await put(first.data, { 'default-user/settings.json': edited });
  const controller = new AbortController();
  let controlReads = 0;
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   * @throws {TypeError}
   */
  line.before = (method, key) => {
    if (method === 'GET' && key === controlKey) {
      controlReads += 1;
      if (controlReads === 1) {
        throw new TypeError('fetch failed', { cause: new Error('ENETUNREACH') });
      }
    }
  };
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   */
  line.after = (method, key) => {
    if (method === 'PUT' && key === controlKey) {
      controller.abort();
    }
  };
  const manual = first.sync.save(SaveReason.Manual);
  const stop = first.sync.save(SaveReason.Stop, { signal: controller.signal });
  const results = await settledSoon(Promise.all([manual, stop]));
  assert.notEqual(results, 'still pending after 2 s');
  assert.deepEqual(results.map((result) => [result.outcome, result.error]), [
    [SaveOutcome.Saved, null], [SaveOutcome.Failed, 'Stopped before the save finished.'],
  ]);
  assert.equal(controlReads, 2);
  assert.ok(first.statuses.some((status) => status.error === `fetch failed Retrying in ${SyncSettings.RetryDelaysMs[0] / 1000} s.`));
  assert.equal((await cloudTree(bucket))['default-user/settings.json'], edited);
  assert.equal(first.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(first.statuses.at(-1).error, 'Stopped before the save finished.');
});

test('a stop signal given while start waits between contact retries rejects at once with the pull message and makes no further request', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const fresh = machine(root, 'b', line.transport);
  await put(fresh.data, starter);
  const controller = new AbortController();
  let requests = 0;
  let afterAbort = 0;
  /**
   * @returns {void}
   */
  line.before = () => {
    requests += 1;
    if (controller.signal.aborted) {
      afterAbort += 1;
    }
  };
  line.down = true;
  /**
   * @returns {Promise<never>}
   */
  fresh.clock.sleep = () => {
    controller.abort();
    return new Promise(() => {});
  };
  await assert.rejects(settledSoon(fresh.sync.start({ signal: controller.signal })), { message: stoppedPull });
  assert.equal(requests, 1);
  assert.equal(afterAbort, 0);
  assert.equal(fresh.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(fresh.statuses.at(-1).error, stoppedPull);
  await assert.rejects(readFile(join(fresh.state, 'sync.json')), { code: 'ENOENT' });
  assert.deepEqual(await tree(fresh.data), starter);
});

test('a stop signal given while a download is in flight aborts that request, and the next start converges with nothing lost or moved twice', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const cloudFiles = Object.fromEntries([...Array(10).keys()].map((index) => [`default-user/chats/Ann/c${index}.jsonl`, `{"n":${index}}\n`]));
  const head = seedManifest(bucket, seedFiles(bucket, cloudFiles));
  seedHead(bucket, head);
  const line = wire(bucket);
  const controller = new AbortController();
  const hung = [];
  const firstHang = Promise.withResolvers();
  let blobReads = 0;
  let afterAbort = 0;
  /**
   * @param {string} method
   * @param {string} key
   * @param {{signal: AbortSignal}} options
   * @returns {?Promise<never>}
   * @throws {Error}
   */
  line.before = (method, key, options) => {
    if (controller.signal.aborted) {
      afterAbort += 1;
    }
    if (!key.includes('/blobs/')) {
      return null;
    }
    blobReads += 1;
    if (blobReads <= 2) {
      return null;
    }
    hung.push(options.signal);
    firstHang.resolve(key);
    return hang(options.signal);
  };
  const fresh = machine(root, 'b', line.transport);
  const mine = { 'default-user/chats/Ann/c3.jsonl': '{"mine":"edited here"}\n' };
  const localOnly = { 'default-user/chats/Ann/local.jsonl': '{"only":"here"}\n' };
  await put(fresh.data, { ...mine, ...localOnly });
  const starting = fresh.sync.start({ signal: controller.signal });
  assert.match(await firstHang.promise, /^_universe\/v2\/blobs\/[0-9a-f]{64}$/);
  controller.abort();
  await assert.rejects(settledSoon(starting), { message: stoppedPull });
  assert.ok(hung.length > 0);
  assert.ok(hung.every((signal) => signal.aborted));
  assert.equal(afterAbort, 0);
  assert.equal(fresh.statuses.at(-1).phase, SyncPhase.Stopped);
  assert.equal(fresh.statuses.at(-1).progress, null);
  await assert.rejects(readFile(join(fresh.state, 'sync.json')), { code: 'ENOENT' });
  const partial = Object.keys(await tree(fresh.data)).filter((path) => path.startsWith('default-user/chats/Ann/c'));
  assert.equal(partial.length, 2, `the stopped pull wrote ${partial.join(', ')}`);
  line.before = null;
  const rerun = machine(root, 'b', line.transport);
  assert.equal((await rerun.sync.start()).changedFiles, 10 - partial.length);
  const local = await tree(rerun.data);
  delete local['cookie-secret.txt'];
  assert.deepEqual(local, { ...cloudFiles, ...localOnly });
  const conflictFolders = await readdir(rerun.conflicts);
  assert.equal(conflictFolders.length, 1);
  assert.deepEqual(await tree(join(rerun.conflicts, conflictFolders[0])), mine);
  assert.equal((await syncState(rerun.state)).revision, head);
  assert.deepEqual((await readdir(join(rerun.data, 'default-user/chats/Ann'))).filter((name) => /\.\d+$/.test(name)), []);
});

test('when every upload times out, the save gives up between 600 s and 600 s plus one attempt timeout after the first failure', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  await writeFile(join(first.data, 'default-user/backgrounds-big.png'), Buffer.alloc(10_000_000, 7));
  let firstFailure = null;
  const timeouts = [];
  /**
   * @param {string} method
   * @param {string} key
   * @param {{timeoutMs: number}} options
   * @returns {void}
   * @throws {Error}
   */
  line.before = (method, key, options) => {
    if (method === 'GET' && key === controlKey) {
      return;
    }
    timeouts.push(options.timeoutMs);
    first.clock.time += options.timeoutMs;
    firstFailure ??= first.clock.now();
    throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  };
  const failed = await first.sync.save(SaveReason.Timer);
  assert.equal(failed.outcome, SaveOutcome.Failed);
  assert.match(failed.error, /: The operation was aborted due to timeout$/);
  const attemptMs = SyncSettings.ObjectTimeoutMs + 10_000_000 / SyncSettings.ObjectBytesPerSecond * 1000;
  assert.ok(timeouts.length > 1);
  assert.ok(timeouts.every((timeoutMs) => timeoutMs === attemptMs), JSON.stringify(timeouts));
  const bound = SyncSettings.TransferGiveUpMs + attemptMs;
  const gaveUpAfter = first.clock.now() - firstFailure;
  assert.ok(gaveUpAfter >= SyncSettings.TransferGiveUpMs, `gave up ${gaveUpAfter} ms after the first failure`);
  assert.ok(gaveUpAfter <= bound, `gave up ${gaveUpAfter} ms after the first failure; the bound is 600 s plus one ${attemptMs} ms attempt`);
});

test('a long pause before the uploads never spends the window: the first upload gets its full timeout and a failure is retried', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const local = join(root, 'a', 'local');
  const clock = fakeClock();
  let jumped = false;
  const sync = new ProfileSync({
    dataRoot: join(local, 'data'),
    stateRoot: join(local, 'data.universe'),
    bucket: bucketName,
    cloud: new CloudStore(line.transport),
    clock,
    /**
     * @param {object} status
     * @returns {void}
     */
    onStatus: (status) => {
      if (status.progress !== null && !jumped) {
        jumped = true;
        clock.time += 700_000;
      }
    },
  });
  await put(join(local, 'data'), starter);
  await sync.start();
  const uploads = [];
  /**
   * @param {string} method
   * @param {string} key
   * @param {{timeoutMs: number}} options
   * @returns {void}
   * @throws {TypeError}
   */
  line.before = (method, key, options) => {
    if (method === 'PUT' && key.includes('/blobs/')) {
      uploads.push(options.timeoutMs);
      if (uploads.length === 1) {
        throw new TypeError('fetch failed', { cause: new Error('ECONNRESET') });
      }
    }
  };
  assert.equal((await sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  assert.ok(jumped);
  assert.equal(uploads.length, Object.keys(starter).length + 1);
  assert.deepEqual(uploads, uploads.map(() => SyncSettings.ObjectTimeoutMs + 1_000));
  assert.deepEqual(await cloudTree(bucket), starter);
});

test('large files on slow links upload within their size-scaled timeout and the other PC pulls them', async (context) => {
  for (const { size, bytesPerSecond } of [{ size: 70_000_000, bytesPerSecond: 100_000 }, { size: 7_000_000, bytesPerSecond: 30_000 }]) {
    const root = await workspace(context);
    const bucket = new MemoryBucket();
    const line = wire(bucket);
    const first = await savedMachine(root, line.transport);
    const video = Buffer.alloc(size, 3);
    await put(first.data, { 'default-user/backgrounds/video.mp4': video });
    /**
     * @param {string} method
     * @param {string} key
     * @param {{body: Buffer, timeoutMs: number}} options
     * @returns {void}
     * @throws {Error}
     */
    line.before = (method, key, options) => {
      if (method === 'PUT' && key.includes('/blobs/')) {
        slowLink(first.clock, options.body.length, bytesPerSecond, options);
      }
    };
    const upload = await first.sync.save(SaveReason.Manual);
    assert.equal(upload.outcome, SaveOutcome.Saved, `${size} at ${bytesPerSecond}: ${upload.error}`);
    line.before = null;
    const second = machine(root, 'b', line.transport);
    /**
     * @param {string} method
     * @param {string} key
     * @param {{timeoutMs: number}} options
     * @returns {void}
     * @throws {Error}
     */
    line.after = (method, key, options) => {
      if (method === 'GET' && key.includes('/blobs/')) {
        slowLink(second.clock, bucket.objects.get(key).body.length, bytesPerSecond, options);
      }
    };
    assert.equal((await second.sync.start()).changedFiles, Object.keys(starter).length + 1);
    assert.ok((await readFile(join(second.data, 'default-user/backgrounds/video.mp4'))).equals(video));
  }
});

test('an ancestry walk retries each manifest read on its own, so a walk where most reads succeed finishes', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const first = await savedMachine(root, line.transport);
  const state = await syncState(first.state);
  const files = Object.entries(state.files).map(([path, entry]) => ({ path, hash: entry.hash, size: entry.size }));
  const pendingId = seedManifest(bucket, files, state.revision);
  let head = pendingId;
  for (let step = 0; step < 9; step += 1) {
    head = seedManifest(bucket, files, head);
  }
  seedHead(bucket, head);
  await writeFile(join(first.state, 'sync.json'), JSON.stringify({ ...state, pending: { id: pendingId, files: state.files } }));
  let manifestReads = 0;
  /**
   * @param {string} method
   * @param {string} key
   * @returns {void}
   * @throws {TypeError}
   */
  line.before = (method, key) => {
    if (key.includes('/manifests/')) {
      manifestReads += 1;
      if (manifestReads % 5 === 0) {
        throw new TypeError('fetch failed', { cause: new Error('ENETUNREACH') });
      }
    }
  };
  const restarted = machine(root, 'a', line.transport);
  const startedAt = restarted.clock.now();
  assert.deepEqual(await restarted.sync.start(), { changedFiles: 0, offline: false, disabled: null });
  assert.ok(restarted.clock.now() - startedAt < 60_000);
  assert.ok(manifestReads >= 11);
  const after = await syncState(restarted.state);
  assert.equal(after.revision, head);
  assert.equal(after.pending, null);
});

test('[9] a folder moved aside into a conflicts path already in use merges into it, and nothing there is overwritten', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport, { ...starter, 'default-user/x/inner.json': '{"inner":1}' });
  const second = machine(root, 'b', bucket.transport);
  await second.sync.start();
  await put(second.data, { 'default-user/x/inner.json': '{"inner":"edited on b"}' });
  await mkdir(join(second.data, 'default-user/x/sub'));
  await rm(join(first.data, 'default-user/x'), { recursive: true });
  await put(first.data, { 'default-user/x': 'x is a file now' });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const restarted = machine(root, 'b', bucket.transport);
  assert.equal((await restarted.sync.start()).changedFiles, 2);
  assert.equal((await tree(restarted.data))['default-user/x'], 'x is a file now');
  const [folder] = await readdir(restarted.conflicts);
  assert.deepEqual(await tree(join(restarted.conflicts, folder)), { 'default-user/x/inner.json': '{"inner":"edited on b"}' });
  assert.deepEqual(await folders(join(restarted.conflicts, folder)), ['default-user', 'default-user/x', 'default-user/x/sub']);
});

test('[9] a clashing name inside a merged folder gets a numeric suffix instead of overwriting', async (context) => {
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const first = await savedMachine(root, bucket.transport, { ...starter, 'default-user/x/inner.json': '{"inner":1}', 'default-user/x/plain': 'p' });
  const second = machine(root, 'b', bucket.transport);
  await second.sync.start();
  await put(second.data, { 'default-user/x/inner.json': '{"inner":"edited on b"}', 'default-user/x/plain': 'edited plain' });
  await mkdir(join(second.data, 'default-user/x/sub'));
  await rm(join(first.data, 'default-user/x'), { recursive: true });
  await put(first.data, { 'default-user/x': 'x is a file now' });
  assert.equal((await first.sync.save(SaveReason.Manual)).outcome, SaveOutcome.Saved);
  const restarted = machine(root, 'b', bucket.transport);
  const blocker = join(restarted.data, 'default-user/x');
  let rewrite = true;
  context.mock.method(fs, 'rmdir',
    /**
     * @param {string} path
     * @param {...*} rest
     * @returns {Promise<void>}
     * @throws {Error}
     */
    async (path, ...rest) => {
      if (path === blocker && rewrite) {
        rewrite = false;
        await writeFile(join(blocker, 'inner.json'), '{"inner":"written during the pull"}');
        await writeFile(join(blocker, 'plain'), 'plain written during the pull');
      }
      return originalRmdir(path, ...rest);
    });
  await restarted.sync.start();
  context.mock.restoreAll();
  const [folder] = await readdir(restarted.conflicts);
  assert.deepEqual(await tree(join(restarted.conflicts, folder)), {
    'default-user/x/inner.json': '{"inner":"edited on b"}',
    'default-user/x/inner-2.json': '{"inner":"written during the pull"}',
    'default-user/x/plain': 'edited plain',
    'default-user/x/plain-2': 'plain written during the pull',
  });
  assert.equal((await tree(restarted.data))['default-user/x'], 'x is a file now');
});

test('save reasons come from SaveReason, and no sync module writes a phase, outcome or reason inline', async () => {
  assert.deepEqual({ ...SaveReason }, { Timer: 'timer', Manual: 'manual', Stop: 'stop', Reconnect: 'reconnect', Start: 'start' });
  assert.ok(Object.isFrozen(SaveReason));
  const values = ['pulling', 'running', 'saving', 'stopping', 'stopped', 'offline', 'conflict', 'disabled', 'failed', 'saved', 'unchanged',
    'blocked', 'timer', 'manual', 'stop', 'reconnect', 'start'];
  const owners = ['SyncPhase.mjs', 'SaveOutcome.mjs', 'SaveReason.mjs'];
  const folder = new URL('../src/sync/', import.meta.url);
  for (const name of (await readdir(folder)).filter((file) => !owners.includes(file))) {
    const source = await readFile(new URL(name, folder), 'utf8');
    for (const value of values) {
      assert.ok(!source.includes(`'${value}'`) && !source.includes(`"${value}"`), `${name} writes '${value}' inline`);
    }
  }
});

test('a size-less 20 MB entry from an old manifest pulls over a 25 KB/s link by its Content-Length, and without one it gets only the unknown-size time', async (context) => {
  for (const omitContentLength of [false, true]) {
    const root = await workspace(context);
    const bucket = new MemoryBucket();
    bucket.omitContentLength = omitContentLength;
    const big = Buffer.alloc(20_000_000, 5);
    seedHead(bucket, seedManifest(bucket, seedFiles(bucket, { 'default-user/backgrounds/big.png': big.toString('latin1') }, false)));
    const line = wire(bucket);
    const fresh = machine(root, 'b', line.transport);
    const bodyTimeouts = [];
    /**
     * @param {string} method
     * @param {string} key
     * @param {{timeoutMs: number, bodyTimeoutMs: Function}} options
     * @returns {void}
     * @throws {Error}
     */
    line.after = (method, key, options) => {
      if (method === 'GET' && key.includes('/blobs/')) {
        assert.equal(options.timeoutMs, SyncSettings.ObjectTimeoutMs);
        const bodyMs = options.bodyTimeoutMs(omitContentLength ? null : String(bucket.objects.get(key).body.length));
        bodyTimeouts.push(bodyMs);
        slowLink(fresh.clock, bucket.objects.get(key).body.length, 25_000, { timeoutMs: bodyMs });
      }
    };
    if (omitContentLength) {
      await assert.rejects(fresh.sync.start(), /^Error: Pull stopped at default-user\/backgrounds\/big\.png: The operation was aborted due to timeout$/);
      assert.ok(bodyTimeouts.length > 1 && bodyTimeouts.every((bodyMs) => bodyMs === SyncSettings.UnknownSizeTimeoutMs), JSON.stringify(bodyTimeouts));
    } else {
      assert.equal((await fresh.sync.start()).changedFiles, 1);
      assert.deepEqual(bodyTimeouts, [SyncSettings.ObjectTimeoutMs + 800_000]);
      assert.ok((await readFile(join(fresh.data, 'default-user/backgrounds/big.png'))).equals(big));
    }
  }
});
