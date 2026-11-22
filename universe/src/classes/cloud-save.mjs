import { randomUUID } from 'node:crypto';
import { digest } from '../r2.mjs';
import { validateEntries } from '../story-files.mjs';

const prefix = '_universe/v2';
const controlKey = `${prefix}/control.json`;
const leaseDuration = 300_000;
export const heartbeatMs = 60_000;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

/**
 * @param {unknown} manifest
 * @param {string} id
 * @returns {void}
 */
export function validateManifest(manifest, id) {
  if (![1, 2].includes(manifest?.version) || manifest.id !== id || !isId(id) ||
      (manifest.parent !== null && (!isId(manifest.parent) || manifest.parent === id))) {
    throw new Error('Invalid cloud manifest.');
  }
  validateEntries(manifest.files, manifest.version);
}

export class CloudSave {
  /**
   * @param {Function} transport
   */
  constructor(transport) {
    this.request = transport;
    this.owner = randomUUID();
    this.mutation = Promise.resolve();
  }

  /**
   * @param {Function} operation
   * @returns {Promise}
   */
  serialize(operation) {
    const next = this.mutation.then(operation);
    this.mutation = next.then(() => undefined, () => undefined);
    return next;
  }

  /**
   * @returns {Promise}
   */
  async control() {
    const response = await this.request('GET', controlKey);
    if (!response.ok && response.status !== 404) {
      throw new Error(`Cloud control read failed (HTTP ${response.status}).`);
    }
    const now = Date.parse(response.headers.get('date'));
    if (!Number.isFinite(now)) {
      throw new Error('Cloud storage did not supply a valid server date.');
    }
    if (response.status === 404) {
      return { value: null, now };
    }
    const etag = response.headers.get('etag');
    if (etag === null || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) {
      throw new Error('Cloud save control response requires a strong ETag. R2 returned a missing, weak or invalid validator.');
    }
    const value = await response.json();
    if (value?.version !== 1 || !isId(value.change) || (value.head !== null && !isId(value.head)) ||
        (value.lease !== null && (!isId(value.lease?.owner) || !Number.isSafeInteger(value.lease.expires)))) {
      throw new Error('Invalid cloud save control object.');
    }
    return { value, etag, now };
  }

  /**
   * @param {object} current
   * @param {object} next
   * @returns {Promise<boolean>}
   */
  async compareAndSet(current, next) {
    const body = JSON.stringify({ version: 1, change: randomUUID(), ...next });
    const response = await this.request('PUT', controlKey, { body, match: current.etag, absent: current.value === null });
    if (response.status === 409 || response.status === 412) {
      return false;
    }
    if (!response.ok) {
      throw new Error(`Cloud control update failed (HTTP ${response.status}).`);
    }
    return true;
  }

  /**
   * @returns {Promise<string | null>}
   */
  async acquire() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.control();
      if (current.value === null) {
        const listing = await this.request('GET', '', { list: true });
        if (!listing.ok) {
          throw new Error(`Cloud bucket inspection failed (HTTP ${listing.status}).`);
        }
        if (!/<KeyCount>0<\/KeyCount>/.test(await listing.text())) {
          if ((await this.control()).value !== null) {
            continue;
          }
          throw new Error('Cloud bucket contains legacy or unrecognized objects. Preserve it and configure an empty bucket.');
        }
      }
      if (current.value?.lease && current.value.lease.expires > current.now) {
        throw new Error('Another launcher holds the cloud save lease.');
      }
      const head = current.value?.head ?? null;
      if (await this.compareAndSet(current, { head, lease: { owner: this.owner, expires: current.now + leaseDuration } })) {
        return head;
      }
    }
    throw new Error('Cloud control changed during lease acquisition. Retry startup.');
  }

  /**
   * @param {'renew' | 'commit' | 'finish' | 'release'} action
   * @param {object} [manifest]
   * @returns {Promise}
   */
  update(action, manifest) {
    return this.serialize(async () => {
      const current = await this.control();
      const lease = current.value?.lease;
      const publishing = action === 'commit' || action === 'finish';
      if (action === 'release' && lease?.owner !== this.owner) {
        return;
      }
      if (lease?.owner !== this.owner || (action !== 'release' && lease.expires <= current.now)) {
        throw new Error('Cloud save lease was lost.');
      }
      if (publishing && current.value.head !== manifest.parent) {
        throw new Error('Cloud save advanced beyond this session’s base.');
      }
      const next = {
        head: publishing ? manifest.id : current.value.head,
        lease: action === 'release' || action === 'finish' ? null : { owner: this.owner, expires: current.now + leaseDuration },
      };
      if (!(await this.compareAndSet(current, next))) {
        throw new Error('Cloud control changed during an owned update.');
      }
    });
  }

  /**
   * @param {string} key
   * @returns {Promise<Buffer>}
   */
  async getObject(key) {
    const response = await this.request('GET', key);
    if (!response.ok) {
      throw new Error(`Cloud object read failed (HTTP ${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * @param {string} key
   * @param {Buffer} bytes
   * @returns {Promise<void>}
   */
  async putImmutable(key, bytes) {
    const response = await this.request('PUT', key, { body: bytes, absent: true });
    if (response.ok) {
      return;
    }
    if ((response.status === 409 || response.status === 412) && (await this.getObject(key)).equals(bytes)) {
      return;
    }
    throw new Error(`Cloud immutable upload failed (HTTP ${response.status}).`);
  }

  /**
   * @param {string} hash
   * @returns {Promise<Buffer>}
   */
  async download(hash) {
    const bytes = await this.getObject(`${prefix}/blobs/${hash}`);
    if (digest(bytes) !== hash) {
      throw new Error('Cloud story content failed its integrity check.');
    }
    return bytes;
  }

  /**
   * @param {string} hash
   * @param {Buffer} bytes
   * @returns {Promise<void>}
   */
  async upload(hash, bytes) {
    if (digest(bytes) !== hash) {
      throw new Error('A story file changed during the final save.');
    }
    await this.putImmutable(`${prefix}/blobs/${hash}`, bytes);
  }

  /**
   * @param {string} id
   * @returns {Promise<object>}
   */
  async manifest(id) {
    const manifest = JSON.parse(await this.getObject(`${prefix}/manifests/${id}.json`));
    validateManifest(manifest, id);
    return manifest;
  }

  /**
   * @returns {Promise<void>}
   */
  async release() {
    try {
      await this.update('release');
    } catch (error) {
      const latest = await this.control().catch(() => null);
      if (!latest || latest.value?.lease?.owner === this.owner) {
        throw error;
      }
    }
  }

  /**
   * @param {string | null} head
   * @param {string} id
   * @param {string | null} [stopAt]
   * @returns {Promise<object | null>}
   */
  async findAncestor(head, id, stopAt = null) {
    const visited = new Set();
    while (head !== null && head !== stopAt && !visited.has(head)) {
      visited.add(head);
      const manifest = await this.manifest(head);
      if (head === id) {
        return manifest;
      }
      head = manifest.parent;
    }
    if (visited.has(head)) {
      throw new Error('Cloud save history contains a cycle.');
    }
    return null;
  }

  /**
   * @param {string | null} head
   * @param {object} expected
   * @returns {Promise<boolean>}
   */
  async includes(head, expected) {
    const manifest = await this.findAncestor(head, expected.id, expected.parent);
    if (manifest && (manifest.version !== expected.version || manifest.parent !== expected.parent || JSON.stringify(manifest.files) !== JSON.stringify(expected.files))) {
      throw new Error('A cloud operation ID matched different story content.');
    }
    return manifest !== null;
  }

  /**
   * @param {object} manifest
   * @param {boolean} finish
   * @returns {Promise<void>}
   */
  async commit(manifest, finish) {
    await this.putImmutable(`${prefix}/manifests/${manifest.id}.json`, Buffer.from(JSON.stringify(manifest)));
    try {
      await this.update(finish ? 'finish' : 'commit', manifest);
    } catch (error) {
      const latest = await this.control().catch(() => null);
      if (!latest || !(await this.includes(latest.value?.head ?? null, manifest))) {
        throw error;
      }
    }
  }
}
