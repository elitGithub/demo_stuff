import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export class TestWorkspace {
  /** @param {string} directory */
  constructor(directory) { this.directory = directory; Object.freeze(this); }
  /** @returns {Promise<TestWorkspace>} */
  static async create() {
    const parent = fileURLToPath(new URL('../../storage/test-runs/', import.meta.url));
    await mkdir(parent, { recursive: true, mode: 0o700 });
    return new TestWorkspace(await mkdtemp(resolve(parent, 'workspace-')));
  }
  /** @param {string} relative @returns {string} */
  path(relative) {
    const path = resolve(this.directory, relative);
    if (!path.startsWith(this.directory + sep)) { throw new TypeError('Test paths must remain inside their workspace.'); }
    return path;
  }
  /** @returns {Promise<void>} */
  async close() {
    const parent = fileURLToPath(new URL('../../storage/test-runs/', import.meta.url));
    if (!this.directory.startsWith(parent) || !/^workspace-[a-zA-Z0-9]+$/.test(this.directory.slice(parent.length))) { throw new TypeError('Invalid test workspace.'); }
    await rm(this.directory, { recursive: true, force: true });
  }
}
