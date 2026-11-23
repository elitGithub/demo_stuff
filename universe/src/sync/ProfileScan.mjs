import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from '../r2.mjs';
import { FileErrors } from './FileErrors.mjs';
import { SyncScope } from './SyncScope.mjs';
import { SyncSettings } from './SyncSettings.mjs';

const readFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const folderProbe = 'folder-probe';
const entryFields = ['hash', 'size', 'mtimeMs', 'hashedAtMs'];
const unresolvedLinkCodes = ['ENOENT', 'ELOOP', 'ENOTDIR'];
const decoder = new TextDecoder();

/**
 * @param {string} dataRoot
 * @param {string} path
 * @param {?{hash: string, size?: number, mtimeMs?: number, hashedAtMs?: number}} known
 * @param {{now: Function}} clock
 * @returns {Promise<{entry: ?{bytes: ?Buffer, hash: string, size: number, mtimeMs: number, hashedAtMs: number}, unsettled: boolean}>}
 * @throws {Error}
 */
async function settle(dataRoot, path, known, clock) {
  const absolute = join(dataRoot, path);
  const lowered = path.toLowerCase();
  const wholeJson = path.startsWith('_storage/') || lowered.endsWith('.json');
  for (let attempt = 0; attempt < SyncSettings.SettleAttempts; attempt += 1) {
    const before = await FileErrors.missing(fs.lstat(absolute));
    if (before === null) {
      return { entry: null, unsettled: false };
    }
    if (!before.isFile()) {
      throw new Error(`Not a regular file: ${path}`);
    }
    const hashedAtMs = clock.now();
    const ageMs = hashedAtMs - before.mtimeMs;
    if (known !== null && ageMs >= 0 && known.size === before.size && known.mtimeMs === before.mtimeMs &&
        known.hashedAtMs - known.mtimeMs >= SyncSettings.QuietMs) {
      return {
        entry: { bytes: null, hash: known.hash, size: before.size, mtimeMs: before.mtimeMs, hashedAtMs: known.hashedAtMs },
        unsettled: false,
      };
    }
    if (ageMs > -SyncSettings.QuietMs && ageMs < SyncSettings.QuietMs) {
      return { entry: null, unsettled: true };
    }
    const handle = await FileErrors.missing(fs.open(absolute, readFlags));
    if (handle === null) {
      return { entry: null, unsettled: false };
    }
    let opened;
    let bytes;
    try {
      opened = await handle.stat();
      if (!opened.isFile()) {
        throw new Error(`Not a regular file: ${path}`);
      }
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    const after = await FileErrors.missing(fs.lstat(absolute));
    if (after === null) {
      return { entry: null, unsettled: false };
    }
    if (opened.ino !== before.ino || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs || bytes.length !== before.size) {
      continue;
    }
    try {
      if (wholeJson) {
        JSON.parse(decoder.decode(bytes));
      } else if (lowered.endsWith('.jsonl')) {
        for (const line of decoder.decode(bytes).split('\n')) {
          if (line.trim() !== '') {
            JSON.parse(line);
          }
        }
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      continue;
    }
    return { entry: { bytes, hash: digest(bytes), size: before.size, mtimeMs: before.mtimeMs, hashedAtMs }, unsettled: false };
  }
  return { entry: null, unsettled: true };
}

export const ProfileScan = Object.freeze({
  /**
   * @param {string} dataRoot
   * @param {Record<string, {hash: string, size?: number, mtimeMs?: number, hashedAtMs?: number}>} known
   * @param {{now: Function}} clock
   * @returns {Promise<{files: Map<string, {hash: string, size?: number, mtimeMs?: number, hashedAtMs?: number}>, unsettled: string[], blocked: ?string}>}
   * @throws {Error}
   */
  async scan(dataRoot, known, clock = Date) {
    const files = new Map();
    const unsettled = [];
    const folders = [''];
    while (folders.length > 0) {
      const folder = folders.pop();
      const listing = await FileErrors.missing(fs.readdir(join(dataRoot, folder), { withFileTypes: true }));
      if (listing === null) {
        continue;
      }
      for (const dirent of listing) {
        const path = folder === '' ? dirent.name : `${folder}/${dirent.name}`;
        const fileInScope = SyncScope.includes(path);
        const folderInScope = SyncScope.includes(`${path}/${folderProbe}`);
        if (dirent.isDirectory()) {
          if (folderInScope) {
            folders.push(path);
          }
        } else if (dirent.isFile()) {
          if (!fileInScope) {
            continue;
          }
          const prior = Object.hasOwn(known, path) ? known[path] : null;
          const outcome = await settle(dataRoot, path, prior, clock);
          if (outcome.unsettled) {
            unsettled.push(path);
          }
          const kept = outcome.unsettled ? prior : outcome.entry;
          if (kept !== null) {
            const present = entryFields.filter((field) => kept[field] !== undefined);
            files.set(path, Object.fromEntries(present.map((field) => [field, kept[field]])));
          }
        } else if (dirent.isSymbolicLink()) {
          let linkInScope;
          try {
            linkInScope = (await fs.stat(join(dataRoot, path))).isDirectory() ? folderInScope : fileInScope;
          } catch (error) {
            if (!unresolvedLinkCodes.includes(error.code)) {
              throw error;
            }
            linkInScope = fileInScope || folderInScope;
          }
          if (linkInScope) {
            return { files, unsettled, blocked: path };
          }
        } else if (fileInScope || folderInScope) {
          return { files, unsettled, blocked: path };
        }
      }
    }
    return { files, unsettled, blocked: null };
  },

  /**
   * @param {string} dataRoot
   * @param {string} path
   * @param {{now: Function}} clock
   * @returns {Promise<?{bytes: Buffer, hash: string, size: number, mtimeMs: number, hashedAtMs: number}>}
   * @throws {Error}
   */
  async read(dataRoot, path, clock = Date) {
    if (!SyncScope.isValid(path)) {
      throw new Error(`Invalid profile path: ${JSON.stringify(path)}`);
    }
    return (await settle(dataRoot, path, null, clock)).entry;
  },
});
