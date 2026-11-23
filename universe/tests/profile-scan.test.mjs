import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs, { lstat, mkdir, mkdtemp, rename, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { digest } from '../src/r2.mjs';
import { CloudStore } from '../src/sync/CloudStore.mjs';
import { ProfileScan } from '../src/sync/ProfileScan.mjs';
import { SyncSettings } from '../src/sync/SyncSettings.mjs';
import { MemoryBucket } from './support/MemoryBucket.mjs';

const originalOpen = fs.open;
const originalReaddir = fs.readdir;
const quietSeconds = 1_700_000_000;
const quietMtimeMs = quietSeconds * 1000;

/**
 * @param {import('node:test').TestContext} context
 * @returns {Promise<string>}
 */
async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'universe-scan-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * @param {string} root
 * @param {string} path
 * @param {string | Buffer} bytes
 * @returns {Promise<void>}
 */
async function write(root, path, bytes) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

/**
 * @param {import('node:test').TestContext} context
 * @param {Function} before
 * @returns {object}
 */
function hookOpen(context, before) {
  return context.mock.method(fs, 'open', async (path, ...rest) => {
    await before(path);
    return originalOpen(path, ...rest);
  });
}

/**
 * @param {object} mocked
 * @param {string} absolute
 * @returns {number}
 */
function opensOf(mocked, absolute) {
  return mocked.mock.calls.filter((call) => call.arguments[0] === absolute).length;
}

/**
 * @param {number} nowMs
 * @returns {{now: Function}}
 */
function clockAt(nowMs) {
  return {
    /**
     * @returns {number}
     */
    now() {
      return nowMs;
    },
  };
}

/**
 * @returns {{now: Function}}
 */
function quietClock() {
  return clockAt(Date.now() + 60_000);
}

test('a plain scan hashes exactly the in-scope files, records the hash moment and never opens excluded ones', async (context) => {
  const data = await fixture(context);
  const inScope = {
    'default-user/settings.json': '{"a":1}',
    'default-user/chats/A/one.jsonl': '{"m":1}\n{"m":2}\n',
    'default-user/chats/backups/old.jsonl': '{"m":0}',
    'default-user/characters/A.png': Buffer.from([0, 1, 2, 255]),
    '_storage/user': '{"key":"user","value":{}}',
    '_css/user.css': 'body{}',
    'constructor': 'prototype key',
    '__proto__': 'prototype key',
  };
  const excluded = [
    '_cache/x.json', '_webpack/a/b.js', 'cookie-secret.txt', 'default-user/backups/settings_1.json',
    'default-user/thumbnails/bg/x.png', 'default-user/assets/temp/a', 'default-user/settings.json.4567', 'a\\b.json',
  ];
  for (const [path, bytes] of Object.entries(inScope)) {
    await write(data, path, bytes);
  }
  for (const path of excluded) {
    await write(data, path, '{broken');
  }
  const opened = hookOpen(context, async () => {});
  const clock = quietClock();
  const result = await ProfileScan.scan(data, {}, clock);
  assert.equal(result.blocked, null);
  assert.deepEqual(result.unsettled, []);
  assert.deepEqual([...result.files.keys()].sort(), Object.keys(inScope).sort());
  for (const [path, bytes] of Object.entries(inScope)) {
    const info = await lstat(join(data, path));
    assert.deepEqual(result.files.get(path), {
      hash: digest(Buffer.from(bytes)), size: info.size, mtimeMs: info.mtimeMs, hashedAtMs: clock.now(),
    }, path);
  }
  for (const path of excluded) {
    assert.equal(opensOf(opened, join(data, path)), 0, path);
  }
});

test('a missing data root scans as empty', async (context) => {
  const data = await fixture(context);
  assert.deepEqual(await ProfileScan.scan(join(data, 'absent'), {}), { files: new Map(), unsettled: [], blocked: null });
});

test('a file modified less than QuietMs before it is read is unsettled, keeps its known entry and is not opened', async (context) => {
  const data = await fixture(context);
  const path = 'default-user/settings.json';
  await write(data, path, '{"v":1}');
  await utimes(join(data, path), quietSeconds, quietSeconds);
  const known = { [path]: { hash: 'c'.repeat(64), size: 3, mtimeMs: 5, hashedAtMs: 9_000 } };
  const opened = hookOpen(context, async () => {});
  const early = await ProfileScan.scan(data, known, clockAt(quietMtimeMs + SyncSettings.QuietMs - 1));
  assert.deepEqual(early.unsettled, [path]);
  assert.deepEqual(early.files.get(path), known[path]);
  assert.equal(opensOf(opened, join(data, path)), 0);
  const settled = await ProfileScan.scan(data, known, clockAt(quietMtimeMs + SyncSettings.QuietMs));
  assert.deepEqual(settled.unsettled, []);
  assert.deepEqual(settled.files.get(path), {
    hash: digest('{"v":1}'), size: 7, mtimeMs: quietMtimeMs, hashedAtMs: quietMtimeMs + SyncSettings.QuietMs,
  });
  await write(data, 'default-user/fresh.json', '{"fresh":1}');
  const fresh = await ProfileScan.scan(data, {});
  assert.deepEqual(fresh.unsettled, ['default-user/fresh.json']);
  assert.equal(fresh.files.has('default-user/fresh.json'), false);
  assert.equal(await ProfileScan.read(data, 'default-user/fresh.json'), null);
  assert.equal(await ProfileScan.read(data, path, clockAt(quietMtimeMs + 1)), null);
  const lagging = await ProfileScan.scan(data, {}, clockAt(quietMtimeMs - 1));
  assert.deepEqual(lagging.unsettled, [path]);
  assert.deepEqual([...lagging.files.keys()], ['default-user/fresh.json']);
  const almostFuture = await ProfileScan.scan(data, {}, clockAt(quietMtimeMs - SyncSettings.QuietMs + 1));
  assert.deepEqual(almostFuture.unsettled, [path]);
  const future = await ProfileScan.scan(data, {}, clockAt(quietMtimeMs - SyncSettings.QuietMs));
  assert.deepEqual(future.unsettled, []);
  assert.deepEqual([...future.files.keys()].sort(), ['default-user/fresh.json', path]);
});

test('a file written a fraction of a millisecond after the clock reading is unsettled, not future-dated', async (context) => {
  const data = await fixture(context);
  const path = 'default-user/user/images/bg.png';
  await write(data, path, Buffer.alloc(64_000, 7));
  const mtimeMs = (await lstat(join(data, path))).mtimeMs;
  const opened = hookOpen(context, async () => {});
  const result = await ProfileScan.scan(data, {}, clockAt(Math.floor(mtimeMs)));
  assert.deepEqual(result.unsettled, [path]);
  assert.equal(result.files.has(path), false);
  assert.equal(opensOf(opened, join(data, path)), 0);
  assert.equal(await ProfileScan.read(data, path, clockAt(Math.floor(mtimeMs))), null);
});

test('a file dated in the future settles on the first scan with its current bytes and is rehashed every scan', async (context) => {
  const data = await fixture(context);
  const paths = ['default-user/characters/Aiko.png', 'default-user/chats/Aiko/new.jsonl', 'default-user/half.json'];
  await write(data, paths[0], Buffer.from([1, 2, 3]));
  await write(data, paths[1], '{"m":1}\n');
  await write(data, paths[2], '{"half":');
  const sevenHours = (Date.now() + 7 * 3_600_000) / 1000;
  for (const path of paths) {
    await utimes(join(data, path), sevenHours, sevenHours);
  }
  const known = { [paths[1]]: { hash: digest('{"m":0}\n'), size: 8, mtimeMs: 1, hashedAtMs: 5_000 } };
  const first = await ProfileScan.scan(data, known);
  assert.deepEqual(first.unsettled, [paths[2]]);
  assert.equal(first.files.get(paths[0]).hash, digest(Buffer.from([1, 2, 3])));
  assert.equal(first.files.get(paths[1]).hash, digest('{"m":1}\n'));
  assert.equal(first.files.has(paths[2]), false);
  const remembered = Object.fromEntries([...first.files].map(([path, entry]) => [path, { ...entry, hashedAtMs: entry.mtimeMs + 60_000 }]));
  const opened = hookOpen(context, async () => {});
  const second = await ProfileScan.scan(data, remembered);
  assert.equal(second.files.get(paths[1]).hash, digest('{"m":1}\n'));
  assert.equal(opensOf(opened, join(data, paths[0])), 1);
  assert.equal(opensOf(opened, join(data, paths[1])), 1);
});

test('the hash cache is reused only when the cached hash was taken at least QuietMs after the modification', async (context) => {
  const data = await fixture(context);
  const paths = ['default-user/close.json', 'default-user/untimed.json', 'default-user/quiet.json', 'default-user/sizeless.json'];
  for (const path of paths) {
    await write(data, path, '{"real":1}');
    await utimes(join(data, path), quietSeconds, quietSeconds);
  }
  const size = Buffer.byteLength('{"real":1}');
  const stale = 'f'.repeat(64);
  const known = {
    'default-user/close.json': { hash: stale, size, mtimeMs: quietMtimeMs, hashedAtMs: quietMtimeMs + SyncSettings.QuietMs - 1 },
    'default-user/untimed.json': { hash: stale, size, mtimeMs: quietMtimeMs },
    'default-user/quiet.json': { hash: stale, size, mtimeMs: quietMtimeMs, hashedAtMs: quietMtimeMs + SyncSettings.QuietMs },
    'default-user/sizeless.json': { hash: stale, mtimeMs: quietMtimeMs, hashedAtMs: quietMtimeMs + SyncSettings.QuietMs },
  };
  const opened = hookOpen(context, async () => {});
  const clock = quietClock();
  const result = await ProfileScan.scan(data, known, clock);
  for (const path of ['default-user/close.json', 'default-user/untimed.json', 'default-user/sizeless.json']) {
    assert.deepEqual(result.files.get(path), { hash: digest('{"real":1}'), size, mtimeMs: quietMtimeMs, hashedAtMs: clock.now() }, path);
    assert.equal(opensOf(opened, join(data, path)), 1, path);
  }
  assert.deepEqual(result.files.get('default-user/quiet.json'), known['default-user/quiet.json']);
  assert.equal(opensOf(opened, join(data, 'default-user/quiet.json')), 0);
});

test('a hash taken by one scan satisfies the quiet rule and is reused by the next scan without opening the file', async (context) => {
  const data = await fixture(context);
  const path = 'default-user/settings.json';
  await write(data, path, '{"temp":0.7}');
  const first = await ProfileScan.scan(data, {}, quietClock());
  const entry = first.files.get(path);
  assert.ok(entry.hashedAtMs - entry.mtimeMs >= SyncSettings.QuietMs);
  const opened = hookOpen(context, async () => {});
  const second = await ProfileScan.scan(data, { [path]: entry }, quietClock());
  assert.deepEqual(second.files.get(path), entry);
  assert.equal(opensOf(opened, join(data, path)), 0);
});

test('a file rewritten between stat and read settles on the second attempt', async (context) => {
  const data = await fixture(context);
  const path = 'default-user/chats/A/one.jsonl';
  await write(data, path, '{"turn":1}\n');
  let rewrites = 0;
  const opened = hookOpen(context, async (target) => {
    if (target === join(data, path) && rewrites === 0) {
      rewrites += 1;
      await writeFile(target, '{"turn":1}\n{"turn":2}\n');
    }
  });
  const result = await ProfileScan.scan(data, {}, quietClock());
  assert.deepEqual(result.unsettled, []);
  assert.equal(result.files.get(path).hash, digest('{"turn":1}\n{"turn":2}\n'));
  assert.equal(result.files.get(path).size, Buffer.byteLength('{"turn":1}\n{"turn":2}\n'));
  assert.equal(opensOf(opened, join(data, path)), 2);
});

test('a same-size replacement by rename with the old time is caught by the inode check', async (context) => {
  const data = await fixture(context);
  const path = 'default-user/settings.json';
  await write(data, path, '{"v":1}');
  await utimes(join(data, path), quietSeconds, quietSeconds);
  let swaps = 0;
  const opened = hookOpen(context, async (target) => {
    if (target === join(data, path) && swaps === 0) {
      swaps += 1;
      await write(data, 'staging/next', '{"v":2}');
      await utimes(join(data, 'staging/next'), quietSeconds, quietSeconds);
      await rename(join(data, 'staging/next'), target);
    }
  });
  const clock = quietClock();
  const result = await ProfileScan.scan(data, {}, clock);
  assert.deepEqual(result.unsettled, []);
  assert.deepEqual(result.files.get(path), { hash: digest('{"v":2}'), size: 7, mtimeMs: quietMtimeMs, hashedAtMs: clock.now() });
  assert.equal(opensOf(opened, join(data, path)), 2);
});

test('a file rewritten on every attempt is unsettled and keeps its known entry, or stays absent without one', async (context) => {
  const data = await fixture(context);
  const known = { 'default-user/settings.json': { hash: 'c'.repeat(64), size: 1, mtimeMs: 1 } };
  await write(data, 'default-user/settings.json', '{"v":0}');
  await write(data, 'default-user/chats/A/new.jsonl', '{"v":0}');
  let counter = 1;
  const opened = hookOpen(context, async (target) => {
    counter += 1;
    await writeFile(target, `{"v":${'9'.repeat(counter)}}`);
  });
  const result = await ProfileScan.scan(data, known, quietClock());
  assert.deepEqual(result.unsettled.sort(), ['default-user/chats/A/new.jsonl', 'default-user/settings.json']);
  assert.deepEqual(result.files, new Map([['default-user/settings.json', known['default-user/settings.json']]]));
  assert.notEqual(result.files.get('default-user/settings.json'), known['default-user/settings.json']);
  assert.equal(opensOf(opened, join(data, 'default-user/settings.json')), SyncSettings.SettleAttempts);
  assert.equal(opensOf(opened, join(data, 'default-user/chats/A/new.jsonl')), SyncSettings.SettleAttempts);
});

test('half-written JSON, JSONL and node-persist records never settle while complete ones do', async (context) => {
  const data = await fixture(context);
  const known = {
    'worlds/w.json': { hash: 'd'.repeat(64), size: 1, mtimeMs: 1 },
    '_storage/5f2b9c1e0a': { hash: 'e'.repeat(64), size: 2, mtimeMs: 2 },
  };
  await write(data, 'default-user/settings.json', '{"a":');
  await write(data, 'default-user/empty.json', '');
  await write(data, 'worlds/w.json', '[1, 2');
  await write(data, 'default-user/UPPER.JSON', '{"a"');
  await write(data, 'default-user/chats/A/broken.jsonl', '{"m":1}\n{"m":');
  await write(data, 'default-user/chats/A/middle.jsonl', '{"m":1}\nnot json\n{"m":3}\n');
  await write(data, 'default-user/chats/A/fine.jsonl', '﻿{"m":1}\r\n\r\n   \n{"m":2}\r\n');
  await write(data, 'default-user/bom.json', '﻿{"a":1}');
  await write(data, 'default-user/notes.txt', '{"a":');
  await write(data, '_storage/5f2b9c1e0a', '{"key":"user:default-user","value":{"handle":"default-us');
  await write(data, '_storage/empty0b', '');
  await write(data, '_storage/records/deep', 'not json');
  await write(data, '_storage/ok', '{"key":"user:default-user","value":{"handle":"default-user"}}');
  const result = await ProfileScan.scan(data, known, quietClock());
  assert.deepEqual(result.unsettled.sort(), [
    '_storage/5f2b9c1e0a', '_storage/empty0b', '_storage/records/deep',
    'default-user/UPPER.JSON', 'default-user/chats/A/broken.jsonl', 'default-user/chats/A/middle.jsonl',
    'default-user/empty.json', 'default-user/settings.json', 'worlds/w.json',
  ]);
  assert.deepEqual([...result.files.keys()].sort(), [
    '_storage/5f2b9c1e0a', '_storage/ok', 'default-user/bom.json', 'default-user/chats/A/fine.jsonl', 'default-user/notes.txt',
    'worlds/w.json',
  ]);
  assert.deepEqual(result.files.get('worlds/w.json'), known['worlds/w.json']);
  assert.deepEqual(result.files.get('_storage/5f2b9c1e0a'), known['_storage/5f2b9c1e0a']);
});

test('a carried-over entry without size stays without size and goes into a manifest', async (context) => {
  const data = await fixture(context);
  const path = 'default-user/user/files/notes.json';
  await write(data, path, '');
  await write(data, 'default-user/settings.json', '{"a":1}');
  const emptyHash = digest('');
  const known = { [path]: { hash: emptyHash } };
  const result = await ProfileScan.scan(data, known, quietClock());
  assert.deepEqual(result.unsettled, [path]);
  assert.deepEqual(result.files.get(path), { hash: emptyHash });
  assert.equal(Object.hasOwn(result.files.get(path), 'size'), false);
  assert.equal(Number.isSafeInteger(result.files.get('default-user/settings.json').size), true);
  const bucket = new MemoryBucket();
  const store = new CloudStore(bucket.transport);
  const id = randomUUID();
  await store.putManifest({ id, parent: null, files: [...result.files].map(([filePath, entry]) => ({ path: filePath, ...entry })) });
  const stored = JSON.parse(bucket.objects.get(`_universe/v2/manifests/${id}.json`).body);
  assert.deepEqual(stored.files.find((entry) => entry.path === path), { path, hash: emptyHash });
});

test('write-file-atomic temp files are ignored without being opened', async (context) => {
  const data = await fixture(context);
  await write(data, 'default-user/settings.json.3141592', '{"half":');
  await write(data, 'default-user/chats/A/c.jsonl.7', 'x');
  const opened = hookOpen(context, async () => {});
  const result = await ProfileScan.scan(data, {}, quietClock());
  assert.deepEqual(result, { files: new Map(), unsettled: [], blocked: null });
  assert.equal(opened.mock.callCount(), 0);
});

test('a symlinked folder in scope blocks the scan', async (context) => {
  const root = await fixture(context);
  const data = join(root, 'data');
  await write(root, 'outside/a.jsonl', '{"x":1}');
  await write(data, 'default-user/settings.json', '{}');
  await symlink(join(root, 'outside'), join(data, 'default-user/chats'));
  const result = await ProfileScan.scan(data, {});
  assert.equal(result.blocked, 'default-user/chats');
});

test('a link is judged by its target: folders by the folder rule, anything else by the file rule', async (context) => {
  const root = await fixture(context);
  const data = join(root, 'data');
  const folder = join(root, 'outside');
  const file = join(root, 'outside/target.json');
  await write(root, 'outside/Llama 3.1/chat.jsonl', '{"m":1}\n');
  await write(root, 'outside/target.json', '{}');
  await write(data, 'default-user/other.json', '{}');
  await mkdir(join(data, '_uploads'));
  await symlink(folder, join(data, '_uploads/link'));
  await mkdir(join(data, 'default-user/assets/temp'), { recursive: true });
  await symlink(file, join(data, 'default-user/assets/temp/link.json'));
  assert.equal((await ProfileScan.scan(data, {})).blocked, null);
  const cases = [
    ['_cache', folder, null],
    ['_webpack', folder, null],
    ['cookie-secret.txt', file, null],
    ['default-user/settings.json.55', file, null],
    ['default-user/thumbnails', folder, null],
    ['default-user/backups', folder, null],
    ['default-user/chats/Llama 3.1', join(root, 'outside/Llama 3.1'), 'default-user/chats/Llama 3.1'],
    ['default-user/linked.json', file, 'default-user/linked.json'],
    ['default-user/settings.json', join(root, 'nowhere'), 'default-user/settings.json'],
    ['_webpack', file, '_webpack'],
    ['default-user/thumbnails', file, 'default-user/thumbnails'],
  ];
  for (const [path, target, blocked] of cases) {
    await mkdir(dirname(join(data, path)), { recursive: true });
    await symlink(target, join(data, path));
    assert.equal((await ProfileScan.scan(data, {})).blocked, blocked, `${path} -> ${target}`);
    await unlink(join(data, path));
  }
  const server = createServer();
  server.listen(join(data, 'default-user/socket'));
  await once(server, 'listening');
  context.after(() => server.close());
  assert.equal((await ProfileScan.scan(data, {})).blocked, 'default-user/socket');
});

test('a link whose target cannot be resolved blocks when either rule puts its path in scope', async (context) => {
  const root = await fixture(context);
  const data = join(root, 'data');
  await write(data, 'default-user/other.json', '{}');
  await mkdir(join(data, 'default-user/chats'));
  const cases = [
    ['default-user/chats/Llama 3.1', '/mnt/unmounted-disk/Llama 3.1'],
    ['default-user/chats/Alice', '/mnt/unmounted-disk/Alice'],
    ['default-user/chats/Loop', join(data, 'default-user/chats/Loop')],
    ['default-user/chats/Through', join(data, 'default-user/other.json/inside')],
    ['_webpack', join(data, '_webpack')],
    ['_cache', join(data, '_cache')],
    ['cookie-secret.txt', join(root, 'nowhere')],
  ];
  for (const [path, target] of cases) {
    await symlink(target, join(data, path));
    assert.equal((await ProfileScan.scan(data, {})).blocked, path, `${path} -> ${target}`);
    await unlink(join(data, path));
  }
  assert.equal((await ProfileScan.scan(data, {})).blocked, null);
  await symlink(join(root, 'nowhere'), join(data, 'default-user/chats/Denied'));
  context.mock.method(fs, 'stat', async () => {
    throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
  });
  await assert.rejects(ProfileScan.scan(data, {}), (error) => error.code === 'EACCES');
});

test('a file deleted during the walk is absent', async (context) => {
  const data = await fixture(context);
  await write(data, 'default-user/afterListing.json', '{}');
  await write(data, 'default-user/beforeOpen.json', '{}');
  await write(data, 'default-user/afterRead.json', '{}');
  await write(data, 'default-user/kept.json', '{}');
  await write(data, 'default-user/gone/inner.json', '{}');
  context.mock.method(fs, 'readdir', async (path, options) => {
    const listing = await originalReaddir(path, options);
    if (path === join(data, 'default-user')) {
      await unlink(join(data, 'default-user/afterListing.json'));
      await rm(join(data, 'default-user/gone'), { recursive: true });
    }
    return listing;
  });
  context.mock.method(fs, 'open', async (path, ...rest) => {
    if (path === join(data, 'default-user/beforeOpen.json')) {
      await unlink(path);
    }
    const handle = await originalOpen(path, ...rest);
    if (path === join(data, 'default-user/afterRead.json')) {
      await unlink(path);
    }
    return handle;
  });
  const known = { 'default-user/afterRead.json': { hash: 'e'.repeat(64), size: 9, mtimeMs: 9 } };
  const result = await ProfileScan.scan(data, known, quietClock());
  assert.equal(result.blocked, null);
  assert.deepEqual(result.unsettled, []);
  assert.deepEqual([...result.files.keys()], ['default-user/kept.json']);
});

test('unchanged size and time reuse the known hash without opening the file, any change rereads', async (context) => {
  const data = await fixture(context);
  await write(data, 'default-user/same.json', '{"same":1}');
  await write(data, 'default-user/touched.json', '{"touched":1}');
  const same = await lstat(join(data, 'default-user/same.json'));
  const touched = await lstat(join(data, 'default-user/touched.json'));
  const known = {
    'default-user/same.json': { hash: 'f'.repeat(64), size: same.size, mtimeMs: same.mtimeMs, hashedAtMs: same.mtimeMs + 60_000 },
    'default-user/touched.json': {
      hash: 'f'.repeat(64), size: touched.size, mtimeMs: touched.mtimeMs - 1, hashedAtMs: touched.mtimeMs + 60_000,
    },
  };
  const opened = hookOpen(context, async () => {});
  const result = await ProfileScan.scan(data, known, quietClock());
  assert.deepEqual(result.files.get('default-user/same.json'), known['default-user/same.json']);
  assert.equal(result.files.get('default-user/touched.json').hash, digest('{"touched":1}'));
  assert.equal(opensOf(opened, join(data, 'default-user/same.json')), 0);
  assert.equal(opensOf(opened, join(data, 'default-user/touched.json')), 1);
});

test('read returns settled bytes, null when absent or unsettled, and refuses links and bad paths', async (context) => {
  const root = await fixture(context);
  const data = join(root, 'data');
  await write(data, 'default-user/settings.json', '{"a":1}');
  await write(data, 'default-user/half.json', '{"a":');
  await write(root, 'outside.json', '{}');
  await symlink(join(root, 'outside.json'), join(data, 'default-user/link.json'));
  const info = await lstat(join(data, 'default-user/settings.json'));
  const clock = quietClock();
  const settled = await ProfileScan.read(data, 'default-user/settings.json', clock);
  assert.deepEqual(settled, {
    bytes: Buffer.from('{"a":1}'), hash: digest('{"a":1}'), size: info.size, mtimeMs: info.mtimeMs, hashedAtMs: clock.now(),
  });
  assert.equal(await ProfileScan.read(data, 'default-user/missing.json', clock), null);
  assert.equal(await ProfileScan.read(data, 'missing-folder/x.json', clock), null);
  assert.equal(await ProfileScan.read(data, 'default-user/settings.json/x', clock), null);
  assert.equal(await ProfileScan.read(data, 'default-user/half.json', clock), null);
  await assert.rejects(ProfileScan.read(data, 'default-user/link.json', clock), /Not a regular file: default-user\/link.json/);
  await assert.rejects(ProfileScan.read(data, 'default-user', clock), /Not a regular file: default-user/);
  for (const path of ['../outside.json', '/etc/hostname', 'a\\b', '']) {
    await assert.rejects(ProfileScan.read(data, path, clock), /Invalid profile path/);
  }
});
