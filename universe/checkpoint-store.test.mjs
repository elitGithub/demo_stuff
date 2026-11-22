import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { captureCheckpoint, clearObsoleteCheckpoints, publishCheckpoint } from './checkpoint-store.mjs';
import { readJournal, writeJournal } from './local-session.mjs';
import { digest } from './r2.mjs';
import { atomicFile } from './story-files.mjs';

const story = 'default-user/chats/scene.jsonl';
const secondStory = 'default-user/group chats/scene.jsonl';

/**
 * @param {import('node:test').TestContext} context
 * @returns {Promise<object>}
 */
async function fixture(context) {
  const directory = await mkdtemp(join(tmpdir(), 'universe-checkpoint-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const roots = { dataRoot: join(directory, 'data'), stateRoot: join(directory, 'sidecar'), rootId: randomUUID() };
  await atomicFile(join(roots.dataRoot, '.universe-story-root'), roots.rootId);
  const journal = await writeJournal(roots, {
    version: 2, rootId: roots.rootId, bucket: 'synthetic', phase: 'editing', operation: randomUUID(), base: null, files: [],
  });
  return { ...roots, base: null, confirmedFiles: [], operation: journal.operation };
}

test('one live capture publishes the final bytes once and keeps later edits for the next capture', async (context) => {
  const options = await fixture(context);
  const paths = [join(options.dataRoot, story), join(options.dataRoot, secondStory)];
  await atomicFile(join(options.dataRoot, 'default-user/secrets.json'), 'synthetic private key');
  assert.deepEqual(await captureCheckpoint(options), { unchanged: true });
  await assert.rejects(readdir(join(options.stateRoot, 'checkpoints')), { code: 'ENOENT' });
  for (const turn of ['first', 'second', 'third']) {
    await atomicFile(paths[0], turn);
  }
  await atomicFile(paths[1], 'third');
  const capture = await captureCheckpoint(options);
  assert.deepEqual(await readdir(join(options.stateRoot, 'checkpoints', capture.id)), [digest('third')]);
  const staged = await readJournal(options.stateRoot);
  assert.deepEqual(staged.manifest.files.map(({ path }) => path), [story, secondStory]);
  const uploads = [];
  const manifests = new Map();
  let head = null;
  const cloud = {
    control: async () => ({ value: { head } }),
    manifest: async (id) => manifests.get(id),
    upload: async (hash, bytes) => {
      uploads.push([hash, bytes.toString()]);
      await atomicFile(paths[0], 'fourth');
    },
    commit: async (manifest, finish) => {
      assert.equal(finish, false);
      assert.equal(manifest.parent, head);
      manifests.set(manifest.id, manifest);
      head = manifest.id;
    },
  };
  await clearObsoleteCheckpoints(options.stateRoot);
  const result = await publishCheckpoint({ cloud, capture, finish: false });
  assert.deepEqual(uploads, [[digest('third'), 'third']]);
  assert.equal(head, capture.id);
  assert.deepEqual(await readJournal(options.stateRoot), result.journal);
  assert.equal(result.journal.phase, 'editing');
  assert.deepEqual(await readdir(join(options.stateRoot, 'checkpoints')), []);
  const later = await captureCheckpoint({ ...options, base: head, confirmedFiles: result.journal.files });
  const second = await publishCheckpoint({ cloud, capture: later, finish: false });
  assert.deepEqual(uploads[1], [digest('fourth'), 'fourth']);
  await Promise.all(paths.map((path) => unlink(path)));
  const deletion = await captureCheckpoint({ ...options, base: head, confirmedFiles: second.journal.files });
  const empty = await publishCheckpoint({ cloud, capture: deletion, finish: false });
  assert.deepEqual(manifests.get(head).files, []);
  assert.equal(uploads.length, 2);
  assert.deepEqual(await captureCheckpoint({ ...options, base: head, confirmedFiles: empty.journal.files }), { unchanged: true });
});

test('interruption during staging cannot turn partial bytes into a completed capture', async (context) => {
  const options = await fixture(context);
  await atomicFile(join(options.dataRoot, story), 'first file');
  await atomicFile(join(options.dataRoot, secondStory), 'second file');
  const directory = join(options.stateRoot, 'checkpoints', options.operation);
  await mkdir(join(directory, digest('second file')), { recursive: true });
  await assert.rejects(captureCheckpoint(options), /Unsafe replacement target/);
  assert.equal(await readFile(join(directory, digest('first file')), 'utf8'), 'first file');
  assert.equal((await readJournal(options.stateRoot)).phase, 'editing');
  await assert.rejects(publishCheckpoint({ capture: { ...options, id: options.operation }, finish: false }), /durable capture marker/);
});

test('damaged staged bytes fail closed even if the live file still matches', async (context) => {
  const options = await fixture(context);
  await atomicFile(join(options.dataRoot, story), 'complete');
  const capture = await captureCheckpoint(options);
  await writeFile(join(options.stateRoot, 'checkpoints', capture.id, digest('complete')), 'damaged');
  const cloud = { control: async () => ({ value: { head: null } }) };
  await assert.rejects(publishCheckpoint({ cloud, capture, finish: false }), /integrity check/);
  assert.equal((await readJournal(options.stateRoot)).manifest.id, capture.id);
});
