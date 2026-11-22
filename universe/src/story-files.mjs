import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { digest } from './r2.mjs';

const areas = new Map([
  ['chats', new Set(['jsonl'])],
  ['group chats', new Set(['jsonl'])],
  ['groups', new Set(['json'])],
  ['characters', new Set(['png', 'webp', 'json'])],
  ['worlds', new Set(['json'])],
]);
/**
 * @param {string} name
 * @param {boolean} hidden
 * @returns {boolean}
 */
function safeName(name, hidden = false) {
  return name.length > 0 && name.length <= 255 && name.isWellFormed() && name === name.normalize('NFC') &&
    (hidden || !name.startsWith('.')) && !/[\u0000-\u001f\u007f<>:"/\\|?*]|[. ]$/u.test(name) &&
    !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name);
}

/**
 * @param {string} path
 * @param {number} format
 * @returns {boolean}
 */
function portablePath(path, format = 1) {
  if (format === 2) {
    const parts = path.split('/');
    return pathAlias(parts[0]) !== '.UNIVERSE-STORY-ROOT' && parts.every(part => safeName(part, true));
  }
  const [profile, area, ...parts] = path.split('/');
  return /^[a-z0-9][a-z0-9_-]*$/i.test(profile) && safeName(profile) &&
    parts.length > 0 && parts.length <= (area === 'chats' ? 2 : 1) && parts.every(safeName) &&
    parts.at(-1).includes('.') && (areas.get(area)?.has(parts.at(-1).split('.').at(-1).toLowerCase()) ?? false);
}

/**
 * @param {string} area
 * @param {string} name
 * @returns {boolean}
 */
function hasStoryExtension(area, name) {
  const extension = /\.([a-z0-9]+)[. ]*$/i.exec(name)?.[1].toLowerCase();
  return areas.get(area).has(extension);
}

/**
 * @param {string} path
 * @returns {string}
 */
function pathAlias(path) {
  return path.toUpperCase().normalize('NFC');
}

/**
 * @param {Array<{path: string, hash: string}>} entries
 * @param {number} format
 * @returns {void}
 */
export function validateEntries(entries, format = 1) {
  if (!Array.isArray(entries)) {
    throw new Error('Invalid story manifest entries.');
  }
  const aliases = new Map();
  const fileNames = new Set();
  const directories = new Set();
  let previous = '';
  for (const entry of entries) {
    const directory = format === 2 && entry?.directory === true;
    if (typeof entry?.path !== 'string' || !portablePath(entry.path, format) || entry.path <= previous ||
        (directory ? Object.hasOwn(entry, 'hash') : (Object.hasOwn(entry, 'directory') || typeof entry.hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.hash)))) {
      throw new Error(`Invalid or unsorted story manifest entry: ${JSON.stringify(entry?.path)}.`);
    }
    previous = entry.path;
    let prefix = '';
    for (const part of entry.path.split('/')) {
      prefix = prefix ? `${prefix}/${part}` : part;
      const alias = pathAlias(prefix);
      if ((aliases.has(alias) && aliases.get(alias) !== prefix) || fileNames.has(prefix)) {
        throw new Error(`Story paths collide on case-insensitive filesystems: ${prefix}.`);
      }
      aliases.set(alias, prefix);
    }
    const parent = entry.path.slice(0, entry.path.lastIndexOf('/'));
    if (format === 2 && entry.path.includes('/') && !directories.has(parent)) {
      throw new Error(`Missing directory for ${entry.path}.`);
    }
    (directory ? directories : fileNames).add(entry.path);
  }
}

/**
 * @param {string} path
 * @returns {Promise<import('node:fs').Stats | null>}
 */
export async function inspect(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * @param {string} directory
 * @returns {Promise<void>}
 */
export async function syncDirectory(directory) {
  if (process.platform === 'win32') {
    return;
  }
  const handle = await open(directory, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} directory
 * @param {boolean} [create]
 * @returns {Promise<boolean>}
 */
export async function checkDirectory(directory, create = false) {
  const parent = dirname(directory);
  if (parent !== directory && !(await checkDirectory(parent, create))) {
    return false;
  }
  let info = await inspect(directory);
  if (!info && create) {
    try {
      await mkdir(directory, { mode: 0o700 });
      await syncDirectory(parent);
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
    info = await inspect(directory);
  }
  if (info && !info.isDirectory()) {
    throw new Error(`Unsafe path component at ${directory}.`);
  }
  return info !== null;
}

/**
 * @param {string} path
 * @returns {Promise<Buffer | null>}
 */
export async function readRegular(path) {
  if (!(await checkDirectory(dirname(path)))) {
    return null;
  }
  const info = await inspect(path);
  if (!info) {
    return null;
  }
  if (!info.isFile() || info.nlink !== 1) {
    throw new Error(`Unsafe file at ${path}.`);
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== info.ino || opened.dev !== info.dev) {
      throw new Error(`File changed while opening ${path}.`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} path
 * @param {Buffer | string} bytes
 * @returns {Promise<void>}
 */
export async function atomicFile(path, bytes) {
  const directory = dirname(path);
  await checkDirectory(directory, true);
  const before = await inspect(path);
  if (before && (!before.isFile() || before.nlink !== 1)) {
    throw new Error(`Unsafe replacement target at ${path}.`);
  }
  const temporary = join(directory, `.universe-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    await syncDirectory(directory);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        throw new AggregateError([error, cleanupError], 'Atomic write and cleanup failed.');
      }
    }
    throw error;
  }
}

/**
 * @param {string} root
 * @param {string} path
 * @param {number} format
 * @returns {string}
 */
export function storyPath(root, path, format = 1) {
  if (!portablePath(path, format)) {
    throw new Error(`Invalid portable story path: ${JSON.stringify(path)}.`);
  }
  return join(root, path);
}

/**
 * @param {string} root
 * @param {number} format
 * @returns {Promise<Array>}
 */
export async function snapshot(root, format = 1) {
  const files = [];
  if (!(await checkDirectory(root))) {
    return files;
  }
  const realRoot = resolve(root);
  if (format === 2) {
    const pending = [''];
    while (pending.length) {
      const parent = pending.pop();
      const directory = join(realRoot, parent);
      if (!(await checkDirectory(directory))) {
        throw new Error(`Directory disappeared during inventory: ${parent}.`);
      }
      for (const raw of await readdir(directory, { encoding: 'buffer' })) {
        const name = raw.toString('utf8');
        if (!Buffer.from(name).equals(raw)) {
          throw new Error(`Non-UTF-8 filename in ${parent || '.'}: ${raw.toString('hex')}.`);
        }
        const path = parent ? `${parent}/${name}` : name;
        if (path === '.universe-story-root') {
          continue;
        }
        const absolute = storyPath(realRoot, path, format);
        const info = await inspect(absolute);
        if (info?.isDirectory()) {
          files.push({ path, directory: true });
          pending.push(path);
        } else {
          const bytes = await readRegular(absolute);
          if (bytes === null) {
            throw new Error(`File disappeared during inventory: ${path}.`);
          }
          files.push({ path, hash: digest(bytes) });
        }
      }
    }
    files.sort((left, right) => left.path < right.path ? -1 : Number(left.path > right.path));
    validateEntries(files, format);
    return files;
  }
  for (const profile of await readdir(realRoot)) {
    if (profile.startsWith('_') || profile.startsWith('.')) {
      continue;
    }
    const profileDir = join(realRoot, profile);
    const profileInfo = await inspect(profileDir);
    if (profileInfo?.isSymbolicLink()) {
      throw new Error(`Unsafe profile directory at ${profileDir}.`);
    }
    if (!profileInfo?.isDirectory()) {
      continue;
    }
    for (const area of areas.keys()) {
      const relative = `${profile}/${area}`;
      const directory = join(realRoot, relative);
      if (!(await checkDirectory(directory))) {
        continue;
      }
      for (const name of await readdir(directory)) {
        const path = `${relative}/${name}`;
        const info = await inspect(join(realRoot, path));
        if (area === 'chats' && info?.isDirectory()) {
          await checkDirectory(join(realRoot, path));
          for (const chat of await readdir(join(realRoot, path))) {
            const chatPath = `${path}/${chat}`;
            if (hasStoryExtension(area, chat)) {
              const bytes = await readRegular(storyPath(realRoot, chatPath));
              if (!bytes) {
                throw new Error('A chat disappeared during story inventory.');
              }
              files.push({ path: chatPath, hash: digest(bytes) });
            }
          }
        } else if (hasStoryExtension(area, name)) {
          const bytes = await readRegular(storyPath(realRoot, path));
          if (!bytes) {
            throw new Error('A file disappeared during story inventory.');
          }
          files.push({ path, hash: digest(bytes) });
        } else if (area === 'chats' && info?.isSymbolicLink()) {
          throw new Error(`Unsafe chat directory at ${join(realRoot, path)}.`);
        }
      }
    }
  }
  files.sort((left, right) => left.path < right.path ? -1 : Number(left.path > right.path));
  validateEntries(files);
  return files;
}

/**
 * @param {Array<{path: string, hash: string}>} files
 * @returns {Map<string, string>}
 */
function directorySpellings(files) {
  const spellings = new Map();
  for (const { path } of files) {
    const parts = path.split('/').slice(0, -1);
    let directory = '';
    for (const part of parts) {
      directory = directory ? `${directory}/${part}` : part;
      spellings.set(pathAlias(directory), directory);
    }
  }
  return spellings;
}

/**
 * @param {string} root
 * @param {string | undefined} before
 * @param {string} after
 * @param {boolean} [allowEmptyDirectory]
 * @returns {Promise<void>}
 */
async function renameSpelling(root, before, after, allowEmptyDirectory = false) {
  const destination = join(root, after);
  const parent = dirname(destination);
  if (!(await checkDirectory(parent))) {
    return;
  }
  const spelling = after.split('/').at(-1);
  const matches = (await readdir(parent)).filter((name) => pathAlias(name) === pathAlias(spelling));
  if (matches.length === 0 || (matches.length === 1 && matches[0] === spelling)) {
    return;
  }
  if (matches.length !== 1) {
    throw new Error('Local paths conflict with a cloud case-only rename. Preserve both local spellings before recovery.');
  }
  const source = join(parent, matches[0]);
  const info = await inspect(source);
  if (!info || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) {
    throw new Error('Unsafe path during a cloud case-only rename.');
  }
  if (matches[0] !== before?.split('/').at(-1) &&
      !(before === undefined && allowEmptyDirectory && info.isDirectory() && (await readdir(source)).length === 0)) {
    throw new Error('Local paths conflict with a cloud case-only rename. Preserve both local spellings before recovery.');
  }
  await rename(source, destination);
  if (!(await readdir(parent)).includes(spelling)) {
    throw new Error('The data filesystem could not apply a cloud case-only rename.');
  }
  await syncDirectory(parent);
}

/**
 * @param {string} root
 * @param {Array<{path: string, hash: string}>} before
 * @param {Array<{path: string, hash: string}>} target
 * @param {Function} download
 * @param {Function} verifyRoot
 * @param {number} format
 * @param {number} beforeFormat
 * @returns {Promise<void>}
 */
export async function restore(root, before, target, download, verifyRoot, format = 1, beforeFormat = format) {
  await verifyRoot();
  validateEntries(before, beforeFormat);
  validateEntries(target, format);
  if (format === 2) {
    const previous = new Map(before.map(entry => [entry.path, entry]));
    if (beforeFormat === 1) {
      for (const path of directorySpellings(before).values()) {
        previous.set(path, { path, directory: true });
      }
    }
    const desired = new Map(target.map(entry => [entry.path, entry]));
    const local = await snapshot(root, format);
    const matches = (entry, other) => other && entry.directory === other.directory && entry.hash === other.hash;
    for (const entry of local) {
      if (!matches(entry, previous.get(entry.path)) && !matches(entry, desired.get(entry.path))) {
        throw new Error(`Local content differs from the cloud restore at ${entry.path}. Preserve both copies before resuming.`);
      }
    }
    const present = new Map(local.map(entry => [entry.path, entry]));
    for (const entry of target) {
      if (!present.has(entry.path) && matches(entry, previous.get(entry.path))) {
        throw new Error(`Local story file disappeared outside the pending restore: ${entry.path}.`);
      }
    }
    for (const entry of local.reverse()) {
      const wanted = desired.get(entry.path);
      if (wanted && wanted.directory === entry.directory) {
        continue;
      }
      await verifyRoot();
      const path = storyPath(root, entry.path, format);
      if (entry.directory) {
        await rmdir(path);
      } else {
        const bytes = await readRegular(path);
        if (bytes === null || digest(bytes) !== entry.hash) {
          throw new Error(`File changed during restore: ${entry.path}.`);
        }
        await unlink(path);
      }
      await syncDirectory(dirname(path));
      present.delete(entry.path);
    }
    for (const entry of target) {
      if (matches(entry, present.get(entry.path))) {
        continue;
      }
      const path = storyPath(root, entry.path, format);
      await verifyRoot();
      if (entry.directory) {
        await checkDirectory(path, true);
      } else {
        const bytes = await download(entry.hash);
        const current = await readRegular(path);
        if (digest(bytes) !== entry.hash || (current === null ? undefined : digest(current)) !== present.get(entry.path)?.hash) {
          throw new Error(`File changed during restore: ${entry.path}.`);
        }
        await verifyRoot();
        await atomicFile(path, bytes);
      }
    }
    const after = await snapshot(root, format);
    if (after.length !== target.length || after.some((entry, index) => entry.path !== target[index].path || !matches(entry, target[index]))) {
      throw new Error('Restored profile does not match the cloud manifest.');
    }
    return;
  }
  const previous = new Map(before.map((entry) => [pathAlias(entry.path), entry]));
  const desired = new Map(target.map((entry) => [pathAlias(entry.path), entry]));
  const oldDirectories = directorySpellings(before);
  const newDirectories = directorySpellings(target);
  const local = new Map((await snapshot(root)).map((entry) => [pathAlias(entry.path), entry]));
  for (const { path, hash } of local.values()) {
    const alias = pathAlias(path);
    const old = previous.get(alias);
    const wanted = desired.get(alias);
    const parts = path.split('/');
    let directory = '';
    for (const part of parts.slice(0, -1)) {
      directory = directory ? `${directory}/${part}` : part;
      const key = pathAlias(directory);
      if (part !== oldDirectories.get(key)?.split('/').at(-1) &&
          part !== newDirectories.get(key)?.split('/').at(-1)) {
        throw new Error('Unexpected local directory spelling during restore.');
      }
    }
    if ((hash !== old?.hash && hash !== wanted?.hash) ||
        (parts.at(-1) !== old?.path.split('/').at(-1) && parts.at(-1) !== wanted?.path.split('/').at(-1))) {
      throw new Error('Local story content changed outside the pending restore. Preserve both copies before resuming.');
    }
  }
  for (const [alias, entry] of previous) {
    if (!local.has(alias) && desired.has(alias)) {
      throw new Error(`Local story file disappeared outside the pending restore: ${entry.path}.`);
    }
  }
  for (const [alias, directory] of newDirectories) {
    await verifyRoot();
    await renameSpelling(root, oldDirectories.get(alias), directory, true);
  }
  const renamed = new Map((await snapshot(root)).map((entry) => [pathAlias(entry.path), entry]));
  const aliases = [...new Set([...previous.keys(), ...desired.keys()])].sort();
  for (const alias of aliases) {
    const wanted = desired.get(alias);
    const actual = renamed.get(alias);
    if (actual?.hash === wanted?.hash && actual?.path === wanted?.path) {
      continue;
    }
    const bytes = wanted && actual?.hash !== wanted.hash ? await download(wanted.hash) : null;
    await verifyRoot();
    const currentPath = storyPath(root, actual?.path ?? wanted.path);
    const current = await readRegular(currentPath);
    if ((current === null ? undefined : digest(current)) !== actual?.hash) {
      throw new Error('A story file changed while restoring.');
    }
    if (!wanted) {
      await unlink(currentPath);
      await syncDirectory(dirname(currentPath));
    } else {
      if (actual && actual.path !== wanted.path) {
        await renameSpelling(root, actual.path, wanted.path);
      }
      if (bytes !== null) {
        await atomicFile(storyPath(root, wanted.path), bytes);
      }
    }
  }
  const resolved = await snapshot(root);
  if (resolved.length !== target.length || resolved.some((entry, index) =>
    entry.path !== target[index].path || entry.hash !== target[index].hash)) {
    throw new Error('Restored story does not match the cloud manifest.');
  }
}
