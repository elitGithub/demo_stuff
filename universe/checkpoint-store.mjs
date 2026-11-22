import { randomUUID } from 'node:crypto';
import { readdir, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isId } from './cloud-save.mjs';
import { readJournal, verifyStoryRoot, writeJournal } from './local-session.mjs';
import { digest } from './r2.mjs';
import { atomicFile, checkDirectory, readRegular, snapshot, storyPath, syncDirectory, validateEntries } from './story-files.mjs';

/**
 * @param {Array} left
 * @param {Array} right
 * @returns {boolean}
 */
export function sameFiles(left, right) {
  return left.length === right.length &&
    left.every((entry, index) => entry.path === right[index].path && entry.hash === right[index].hash);
}

/**
 * @param {string} stateRoot
 * @returns {Promise<void>}
 */
export async function clearObsoleteCheckpoints(stateRoot) {
  const journal = await readJournal(stateRoot);
  const parent = join(stateRoot, 'checkpoints');
  if (!journal || !(await checkDirectory(parent))) {
    return;
  }
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!isId(entry.name) || !entry.isDirectory() ||
        entry.name === journal.operation || entry.name === journal.manifest?.id) {
      continue;
    }
    const directory = join(parent, entry.name);
    await checkDirectory(directory);
    const blobs = await readdir(directory, { withFileTypes: true });
    if (blobs.some((blob) => !blob.isFile() || (!/^[a-f0-9]{64}$/.test(blob.name) &&
        !(blob.name.startsWith('.universe-') && blob.name.endsWith('.tmp') && isId(blob.name.slice(10, -4)))))) {
      continue;
    }
    for (const blob of blobs) {
      await unlink(join(directory, blob.name));
    }
    await rmdir(directory);
    await syncDirectory(parent);
  }
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function captureCheckpoint({ dataRoot, stateRoot, rootId, base, confirmedFiles }) {
  await verifyStoryRoot(dataRoot, rootId);
  const journal = await readJournal(stateRoot);
  const legacy = journal?.version === 1 && journal.phase === 'publishing';
  validateEntries(confirmedFiles);
  if (!journal || journal.rootId !== rootId || journal.base !== base || (base === null && confirmedFiles.length) ||
      (!legacy && (journal.version !== 2 || journal.phase !== 'editing' || !sameFiles(journal.files, confirmedFiles)))) {
    throw new Error('Checkpoint does not match the active local save journal.');
  }
  const files = await snapshot(dataRoot);
  await verifyStoryRoot(dataRoot, rootId);
  if (legacy && !sameFiles(files, journal.manifest.files)) {
    throw new Error('Story files changed after a legacy save attempt. Preserve the data and journal for reconciliation.');
  }
  if (!legacy && sameFiles(files, confirmedFiles)) {
    return { unchanged: true };
  }
  const manifest = legacy ? journal.manifest : { version: 1, id: journal.operation, parent: base, files };
  const directory = join(stateRoot, 'checkpoints', manifest.id);
  await checkDirectory(directory, true);
  const known = new Set(confirmedFiles.map(({ hash }) => hash));
  for (const { path, hash } of files) {
    if (!known.has(hash)) {
      const bytes = await readRegular(storyPath(dataRoot, path));
      if (bytes === null || digest(bytes) !== hash) {
        throw new Error('Story bytes changed during checkpoint capture.');
      }
      await atomicFile(join(directory, hash), bytes);
      known.add(hash);
    }
  }
  await writeJournal({ dataRoot, stateRoot }, {
    version: 2, bucket: journal.bucket, rootId, phase: 'publishing', base, files: confirmedFiles, manifest,
  });
  return { unchanged: false, dataRoot, stateRoot, rootId, id: manifest.id };
}

/**
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function publishCheckpoint({ cloud, capture, finish, beforeCommit, uploadedHashes }) {
  const { dataRoot, stateRoot, rootId, id } = capture;
  await verifyStoryRoot(dataRoot, rootId);
  const journal = await readJournal(stateRoot);
  if (journal?.phase !== 'publishing' || journal.rootId !== rootId || journal.manifest.id !== id) {
    throw new Error('Checkpoint is missing its durable capture marker.');
  }
  const { manifest, base } = journal;
  let head = (await cloud.control()).value?.head ?? null;
  if (head !== base) {
    if (!(await cloud.includes(head, manifest))) {
      throw new Error('Cloud and pending local story have diverged. Preserve both copies and reconcile manually.');
    }
    await verifyStoryRoot(dataRoot, rootId);
    if (finish) {
      await beforeCommit?.();
      await cloud.release();
    }
  } else {
    const parentFiles = base === null ? [] : (await cloud.manifest(base)).files;
    if (journal.version === 1) {
      await captureCheckpoint({ dataRoot, stateRoot, rootId, base, confirmedFiles: parentFiles });
    } else if (!sameFiles(parentFiles, journal.files)) {
      throw new Error('Cloud history differs from the last known local revision. Preserve both copies before recovery.');
    }
    const known = new Set(parentFiles.map(({ hash }) => hash));
    for (const { hash } of manifest.files) {
      if (!known.has(hash)) {
        const bytes = await readRegular(join(stateRoot, 'checkpoints', id, hash));
        if (bytes === null || digest(bytes) !== hash) {
          throw new Error('Staged checkpoint bytes failed their integrity check.');
        }
        if (!uploadedHashes?.has(hash)) {
          await cloud.upload(hash, bytes);
        }
        known.add(hash);
      }
    }
    await beforeCommit?.();
    await verifyStoryRoot(dataRoot, rootId);
    await cloud.commit(manifest, finish);
    head = manifest.id;
  }
  const next = await writeJournal({ dataRoot, stateRoot }, {
    version: 2, bucket: journal.bucket, rootId, base: manifest.id, files: manifest.files,
    ...(finish ? { phase: 'clean' } : { phase: 'editing', operation: randomUUID() }),
  });
  await clearObsoleteCheckpoints(stateRoot);
  return { journal: next, head };
}
