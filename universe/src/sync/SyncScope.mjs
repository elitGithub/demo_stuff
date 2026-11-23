import { SyncSettings } from './SyncSettings.mjs';

export const SyncScope = Object.freeze({
  /**
   * @param {unknown} path
   * @returns {boolean}
   */
  isValid(path) {
    return typeof path === 'string' && path !== '' && !path.startsWith('/') && !path.includes('\\') &&
      !path.includes('\0') && path.isWellFormed() &&
      path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  },

  /**
   * @param {unknown} path
   * @returns {boolean}
   */
  includes(path) {
    if (!SyncScope.isValid(path) || SyncSettings.TempFilePattern.test(path.slice(path.lastIndexOf('/') + 1))) {
      return false;
    }
    if (SyncSettings.RootExcluded.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry))) {
      return false;
    }
    const user = path.split('/', 1)[0];
    const below = path.slice(user.length + 1);
    return user.startsWith('_') || !SyncSettings.UserExcluded.some((folder) => below.startsWith(folder));
  },

  /**
   * @param {unknown} list
   * @returns {Array<{path: string, hash: string, size?: number}>}
   * @throws {Error}
   */
  entries(list) {
    if (!Array.isArray(list)) {
      throw new Error('Invalid cloud manifest entries.');
    }
    const kept = [];
    const paths = new Set();
    for (const entry of list) {
      if (!SyncScope.isValid(entry?.path)) {
        throw new Error(`Invalid path in cloud manifest: ${JSON.stringify(entry?.path)}`);
      }
      if (entry.directory === true || !SyncScope.includes(entry.path)) {
        continue;
      }
      const sized = entry.size !== undefined;
      if (typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash) || paths.has(entry.path) ||
          (sized && (!Number.isSafeInteger(entry.size) || entry.size < 0))) {
        throw new Error(`Invalid entry in cloud manifest: ${JSON.stringify(entry.path)}`);
      }
      paths.add(entry.path);
      kept.push(sized ? { path: entry.path, hash: entry.hash, size: entry.size } : { path: entry.path, hash: entry.hash });
    }
    for (const { path } of kept) {
      for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
        if (paths.has(path.slice(0, slash))) {
          throw new Error(`Invalid entry in cloud manifest: ${JSON.stringify(path)}`);
        }
      }
    }
    return kept;
  },
});
