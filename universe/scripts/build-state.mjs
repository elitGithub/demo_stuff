import { constants, lstatSync } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * @param {string} path
 * @returns {import('node:fs').Stats | undefined}
 */
export function inspect(path) {
  return lstatSync(path, { throwIfNoEntry: false });
}

/**
 * @param {string} directory
 * @returns {boolean}
 */
export function checkDirectory(directory) {
  const parent = dirname(directory);
  if (parent !== directory && !checkDirectory(parent)) {
    return false;
  }
  const entry = inspect(directory);
  if (entry && !entry.isDirectory()) {
    throw new Error(`Unsafe build directory at ${directory}.`);
  }
  return Boolean(entry);
}

/**
 * @param {string} path
 * @returns {Promise<Buffer | null>}
 */
export async function readRegular(path) {
  if (!checkDirectory(dirname(path))) {
    return null;
  }
  const entry = inspect(path);
  if (!entry) {
    return null;
  }
  if (!entry.isFile() || entry.nlink !== 1) {
    throw new Error(`Unsafe build file at ${path}.`);
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== entry.ino || opened.dev !== entry.dev) {
      throw new Error(`Build file changed while opening ${path}.`);
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} directory
 * @returns {Promise<void>}
 */
async function syncDirectory(directory) {
  if (process.platform !== 'win32') {
    const handle = await open(directory, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

/**
 * @param {string} directory
 * @returns {Promise<string>}
 */
export async function claimBuild(directory) {
  if (!checkDirectory(directory)) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await syncDirectory(dirname(directory));
    if (!checkDirectory(directory)) {
      throw new Error('Universe build ownership directory disappeared.');
    }
  }
  const latest = (await readdir(directory)).reduce((highest, name) => {
    const suffix = /^owner-([1-9][0-9]*)$/.exec(name)?.[1];
    return suffix ? Math.max(highest, Number(suffix)) : highest;
  }, 0);
  if (!Number.isSafeInteger(latest + 1)) {
    throw new Error('Invalid Universe build owner generation.');
  }
  const current = join(directory, `owner-${latest}`);
  if (latest && await readRegular(join(current, 'released')) === null) {
    for (const file of ['pid.json', 'child.json']) {
      const pid = JSON.parse(await readRegular(join(current, file)));
      if (file === 'child.json' && pid === null) {
        continue;
      }
      if (!Number.isSafeInteger(pid) || pid < 1) {
        throw new Error('Invalid process ID in the Universe build owner record.');
      }
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          continue;
        }
        if (error.code !== 'EPERM') {
          throw error;
        }
      }
      throw new Error('The Universe build is already in use by another publisher.');
    }
  }
  const owner = join(directory, `owner-${latest + 1}`);
  const temporary = await mkdtemp(join(directory, '.claim-'));
  try {
    await writeFile(join(temporary, 'pid.json'), JSON.stringify(process.pid), { flag: 'wx', mode: 0o600, flush: true });
    await syncDirectory(temporary);
    await rename(temporary, owner);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  await syncDirectory(directory);
  return owner;
}

/**
 * @param {string} owner
 * @returns {Promise<void>}
 */
export async function releaseBuild(owner) {
  if (!checkDirectory(owner)) {
    throw new Error('Universe build owner directory disappeared.');
  }
  await writeFile(join(owner, 'released'), '', { flag: 'wx', mode: 0o600, flush: true });
  await syncDirectory(owner);
}
