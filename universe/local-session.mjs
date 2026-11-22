import { randomUUID } from 'node:crypto';
import { readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { isId, validateManifest } from './cloud-save.mjs';
import { atomicFile, checkDirectory, inspect, readRegular, syncDirectory, validateEntries } from './story-files.mjs';

/**
 * @param {string} dataRoot
 * @param {string} rootId
 * @returns {Promise<void>}
 */
export async function verifyStoryRoot(dataRoot, rootId) {
  const stored = await readRegular(join(dataRoot, '.universe-story-root'));
  if (!isId(rootId) || stored?.toString() !== rootId) {
    throw new Error('The effective story directory is missing or was replaced. Restore the original directory with its Universe identity file.');
  }
}

/**
 * @param {object} roots
 * @param {object} journal
 * @returns {Promise<object>}
 */
export async function writeJournal({ dataRoot, stateRoot }, journal) {
  await verifyStoryRoot(dataRoot, journal.rootId);
  await atomicFile(join(stateRoot, 'journal.json'), JSON.stringify(journal));
  return journal;
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    throw new Error('Invalid process ID in the Universe local owner record.');
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') {
      return false;
    }
    if (error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

/**
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function claimLocal(directory) {
  await checkDirectory(directory, true);
  const last = (await readdir(directory)).reduce((highest, name) => {
    const suffix = /^owner-([1-9][0-9]*)$/.exec(name)?.[1];
    return suffix ? Math.max(highest, Number(suffix)) : highest;
  }, 0);
  if (!Number.isSafeInteger(last + 1)) {
    throw new Error('Invalid Universe local owner generation.');
  }
  if (last > 0) {
    const existing = join(directory, `owner-${last}`);
    if (!(await checkDirectory(existing))) {
      throw new Error('Universe local owner record disappeared.');
    }
    if ((await readRegular(join(existing, 'released'))) === null) {
      const owner = JSON.parse((await readRegular(join(existing, 'pid.json'))) ?? 'null');
      const child = JSON.parse((await readRegular(join(existing, 'child.json'))) ?? 'null');
      if (isAlive(owner) || (child !== null && isAlive(child))) {
        throw new Error('This story directory is already in use by a launcher or its child.');
      }
    }
  }
  const temporary = join(directory, `.claim-${randomUUID()}`);
  const ownerPath = join(directory, `owner-${last + 1}`);
  await checkDirectory(temporary, true);
  await atomicFile(join(temporary, 'pid.json'), JSON.stringify(process.pid));
  try {
    await rename(temporary, ownerPath);
  } catch (error) {
    if (!(await inspect(ownerPath))) {
      throw error;
    }
    await unlink(join(temporary, 'pid.json'));
    await rmdir(temporary);
    throw new Error('Another launcher just claimed the local story directory.');
  }
  await syncDirectory(directory);
  return ownerPath;
}

/**
 * @param {string} directory
 * @returns {Promise<object | null>}
 */
export async function readJournal(directory) {
  const bytes = await readRegular(join(directory, 'journal.json'));
  if (bytes === null) {
    return null;
  }
  const journal = JSON.parse(bytes);
  if (![1, 2].includes(journal?.version) || typeof journal.bucket !== 'string' || !isId(journal.rootId) ||
      (journal.base !== null && !isId(journal.base))) {
    throw new Error('Invalid local save journal. Preserve the story directory and its sidecar for recovery.');
  }
  if (journal.version === 2) {
    validateEntries(journal.files);
    if (journal.base === null && journal.files.length > 0) {
      throw new Error('Local journal has a confirmed inventory without a base.');
    }
  }
  if (journal.phase === 'publishing') {
    validateManifest(journal.manifest, journal.manifest?.id);
    if (journal.manifest.parent !== journal.base) {
      throw new Error('Local operation has an inconsistent base.');
    }
  } else if (journal.phase === 'restoring') {
    if (!isId(journal.target)) {
      throw new Error('Invalid pending restore target.');
    }
    validateEntries(journal.files);
  } else if (journal.phase === 'editing') {
    if (!isId(journal.operation)) {
      throw new Error('Invalid pending edit operation.');
    }
  } else if (journal.phase === 'clean') {
    validateEntries(journal.files);
  } else {
    throw new Error('Invalid local save journal phase.');
  }
  return journal;
}
