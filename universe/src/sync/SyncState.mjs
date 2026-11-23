import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { SyncScope } from './SyncScope.mjs';

const idPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

/**
 * @param {string} path
 * @returns {Promise<*>}
 * @throws {Error}
 */
async function readJson(path) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * @param {unknown} files
 * @returns {boolean}
 */
function validFiles(files) {
  return files !== null && typeof files === 'object' && !Array.isArray(files) &&
    Object.entries(files).every(([path, entry]) => SyncScope.isValid(path) && /^[a-f0-9]{64}$/.test(entry?.hash));
}

export const SyncState = Object.freeze({
  /**
   * @param {string} stateRoot
   * @param {string} bucket
   * @returns {Promise<{bucket: string, revision: ?string, pending: ?{id: string, files: object}, files: ?object}|{mismatch: string}|null>}
   * @throws {Error}
   */
  async read(stateRoot, bucket) {
    const state = await readJson(join(stateRoot, 'sync.json'));
    if (state !== null) {
      if (typeof state.bucket !== 'string' || (state.revision !== null && !idPattern.test(state.revision)) ||
          !validFiles(state.files) || (state.pending !== null && (!idPattern.test(state.pending?.id) || !validFiles(state.pending.files)))) {
        throw new Error(`Invalid local sync state: ${join(stateRoot, 'sync.json')}`);
      }
      return state.bucket === bucket ? { bucket, revision: state.revision, pending: state.pending, files: state.files } : { mismatch: state.bucket };
    }
    const journal = await readJson(join(stateRoot, 'journal.json'));
    if (typeof journal?.base !== 'string' || !idPattern.test(journal.base)) {
      return null;
    }
    if (journal.bucket !== bucket) {
      return { mismatch: String(journal.bucket) };
    }
    const files = journal.format === 2 ?
      Object.fromEntries(SyncScope.entries(journal.files).map((entry) => [entry.path, { hash: entry.hash }])) : null;
    return { bucket, revision: journal.base, pending: null, files };
  },

  /**
   * @param {string} stateRoot
   * @param {{bucket: string, revision: ?string, pending: ?{id: string, files: object}, files: object}} state
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async write(stateRoot, state) {
    await fs.mkdir(stateRoot, { recursive: true });
    const target = join(stateRoot, 'sync.json');
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ bucket: state.bucket, revision: state.revision, pending: state.pending, files: state.files }));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, target);
  },
});
