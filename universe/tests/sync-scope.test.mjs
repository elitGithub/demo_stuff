import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyncScope } from '../src/sync/SyncScope.mjs';
import { SyncSettings } from '../src/sync/SyncSettings.mjs';

const hash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);

test('settings and scope are frozen', () => {
  assert.ok(Object.isFrozen(SyncSettings));
  assert.ok(Object.isFrozen(SyncSettings.RetryDelaysMs));
  assert.ok(Object.isFrozen(SyncSettings.RootExcluded));
  assert.ok(Object.isFrozen(SyncSettings.UserExcluded));
  assert.ok(Object.isFrozen(SyncScope));
  assert.throws(() => {
    SyncSettings.Concurrency = 99;
  }, TypeError);
});

test('every excluded root entry is out and its near misses are in', () => {
  for (const path of [
    '_cache/x', '_cache/deep/x.json', '_webpack/a/b.js', '_uploads/f.png', '_errors/e.log', 'cookie-secret.txt',
    'content.log', 'access.log', 'heartbeat.json', '.universe-story-root',
  ]) {
    assert.equal(SyncScope.includes(path), false, path);
  }
  for (const path of [
    '_cachex/a', '_cache', 'x_cache/a', 'default-user/cookie-secret.txt', 'default-user/heartbeat.json',
    'cookie-secret.txt.bak', '_storage/user', '_storage/backups/x', '_css/user.css', 'config.yaml.json',
  ]) {
    assert.equal(SyncScope.includes(path), true, path);
  }
});

test('user backups, thumbnails and asset temp are out only directly under a user folder', () => {
  for (const path of [
    'default-user/backups/settings_20261122.json', 'default-user/thumbnails/bg/x.png', 'default-user/assets/temp/a.bin',
    'other/backups/a', '.hidden/thumbnails/a',
  ]) {
    assert.equal(SyncScope.includes(path), false, path);
  }
  for (const path of [
    'default-user/chats/backups/x.jsonl', 'default-user/assets/tempx/a', 'default-user/assets/a/temp/b',
    'default-user/backupsx/a', '_storage/thumbnails/a', '_x/assets/temp/a', 'default-user/settings.json', 'backups/a',
  ]) {
    assert.equal(SyncScope.includes(path), true, path);
  }
});

test('write-file-atomic temporary names are out', () => {
  for (const path of ['default-user/settings.json.12345', 'default-user/chats/A/chat.jsonl.4', 'x.0', '_storage/a.99']) {
    assert.equal(SyncScope.includes(path), false, path);
  }
  for (const path of ['default-user/v1.5.json', 'default-user/file.12a', 'default-user/12345', 'default-user/a.1/b']) {
    assert.equal(SyncScope.includes(path), true, path);
  }
});

test('traversal, backslash, NUL, empty segments and absolute paths are invalid', () => {
  for (const path of [
    '', '/abs', '/', '../x', 'a/../b', 'a/..', '..', '.', './a', 'a/./b', 'a\\b', '..\\x', 'a\0b', 'a//b', 'a/', '/a/',
    'a\uD800', null, undefined, 5, {}, ['a'],
  ]) {
    assert.equal(SyncScope.isValid(path), false, JSON.stringify(path));
    assert.equal(SyncScope.includes(path), false, JSON.stringify(path));
  }
  for (const path of ['a', 'a..b/c...jsonl', '.hidden/x', 'default-user/chats/A B/c.jsonl', 'é/ü']) {
    assert.equal(SyncScope.isValid(path), true, path);
  }
});

test('entries drop the current head out-of-scope and folder entries and keep size only when present', () => {
  const head = [
    { path: '_webpack', directory: true },
    { path: '_webpack/bundle.js', hash },
    { path: 'cookie-secret.txt', hash },
    { path: 'default-user', directory: true },
    { path: 'default-user/backups', directory: true },
    { path: 'default-user/backups/settings_1.json', hash },
    { path: 'default-user/chats', directory: true },
    { path: 'default-user/chats/A', directory: true },
    { path: 'default-user/chats/A/one.jsonl', hash: otherHash, size: 12, extra: 'dropped' },
    { path: 'default-user/settings.json', hash, directory: false },
    { path: 'default-user/settings.json.777', hash },
  ];
  assert.deepEqual(SyncScope.entries(head), [
    { path: 'default-user/chats/A/one.jsonl', hash: otherHash, size: 12 },
    { path: 'default-user/settings.json', hash },
  ]);
  assert.deepEqual(SyncScope.entries([]), []);
});

test('entries reject the whole list on the first invalid path, even inside excluded folders or folder entries', () => {
  for (const path of [
    'default-user/../../etc/passwd', '_webpack/../../x', 'a\\b', 'a//b', '/etc/passwd', '', 'a\0b', undefined, 7,
  ]) {
    assert.throws(() => SyncScope.entries([{ path: 'default-user/ok.json', hash }, { path, hash }]),
      (error) => error.message === `Invalid path in cloud manifest: ${JSON.stringify(path)}`, String(path));
    assert.throws(() => SyncScope.entries([{ path, directory: true }]), /Invalid path in cloud manifest/);
  }
  assert.throws(() => SyncScope.entries([null]), /Invalid path in cloud manifest: undefined/);
  assert.throws(() => SyncScope.entries('not a list'), /Invalid cloud manifest entries/);
  assert.throws(() => SyncScope.entries(null), /Invalid cloud manifest entries/);
});

test('entries reject bad hashes, bad sizes, duplicates and a file that is also a folder', () => {
  const rejected = [
    [{ path: 'a.json' }],
    [{ path: 'a.json', hash: 'A'.repeat(64) }],
    [{ path: 'a.json', hash: 'a'.repeat(63) }],
    [{ path: 'a.json', hash, size: -1 }],
    [{ path: 'a.json', hash, size: 1.5 }],
    [{ path: 'a.json', hash, size: '3' }],
    [{ path: 'a.json', hash, size: null }],
    [{ path: 'a.json', hash }, { path: 'a.json', hash: otherHash }],
    [{ path: 'default-user/a', hash }, { path: 'default-user/a/b.json', hash }],
    [{ path: 'default-user/a/b/c.json', hash }, { path: 'default-user/a', hash }],
  ];
  for (const list of rejected) {
    assert.throws(() => SyncScope.entries(list), /Invalid entry in cloud manifest/, JSON.stringify(list));
  }
  assert.deepEqual(SyncScope.entries([{ path: 'a', hash }, { path: 'ab/c', hash }, { path: 'a.json', hash, size: 0 }]),
    [{ path: 'a', hash }, { path: 'ab/c', hash }, { path: 'a.json', hash, size: 0 }]);
  assert.deepEqual(SyncScope.entries([{ path: '_cache', hash }, { path: '_cache/x', hash: 'not a hash' }]), [{ path: '_cache', hash }]);
});

test('entries accept sizeless entries and never emit an undefined size', () => {
  const kept = SyncScope.entries([{ path: 'a.json', hash }, { path: 'b.json', hash, size: undefined }, { path: 'c.json', hash, size: 4 }]);
  assert.deepEqual(kept, [{ path: 'a.json', hash }, { path: 'b.json', hash }, { path: 'c.json', hash, size: 4 }]);
  assert.equal(Object.hasOwn(kept[1], 'size'), false);
});
