import { randomUUID } from 'node:crypto';
import { digest } from '../r2.mjs';
import { SyncScope } from './SyncScope.mjs';
import { SyncSettings } from './SyncSettings.mjs';

const universeFolder = '_universe/';
const prefix = `${universeFolder}v2`;
const controlKey = `${prefix}/control.json`;
const strongEtag = /^"[\x21\x23-\x7e\x80-\xff]*"$/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}

/**
 * @param {string} action
 * @param {Response} response
 * @returns {Error}
 */
function failure(action, response) {
  return Object.assign(new Error(`${action} failed (HTTP ${response.status}).`), { status: response.status });
}

/**
 * @param {number} sizeBytes
 * @returns {number}
 */
function sizedTimeoutMs(sizeBytes) {
  return SyncSettings.ObjectTimeoutMs + Math.ceil(sizeBytes / SyncSettings.ObjectBytesPerSecond) * 1000;
}

/**
 * @param {?string} contentLength
 * @returns {number}
 */
function bodyTimeoutMs(contentLength) {
  const length = /^\d+$/.test(String(contentLength)) ? Number(contentLength) : Number.NaN;
  return Math.min(Number.isSafeInteger(length) ? sizedTimeoutMs(length) : SyncSettings.UnknownSizeTimeoutMs, SyncSettings.MaxTimerMs);
}

export class CloudStore {
  #transport;

  /**
   * @param {Function} transport
   */
  constructor(transport) {
    this.#transport = transport;
  }

  /**
   * @param {{signal?: AbortSignal}} attempt
   * @returns {Promise<{exists: boolean, head: ?string, etag: ?string, savedAt: ?number, now: number}>}
   * @throws {Error}
   */
  async readControl(attempt = {}) {
    const response = await this.#send('GET', controlKey, SyncSettings.ControlTimeoutMs, attempt);
    if (!response.ok && response.status !== 404) {
      throw failure('Cloud control read', response);
    }
    const now = Date.parse(response.headers.get('date'));
    if (!Number.isFinite(now)) {
      throw new Error('Cloud storage did not supply a valid server date.');
    }
    if (response.status === 404) {
      return { exists: false, head: null, etag: null, savedAt: null, now };
    }
    const etag = response.headers.get('etag');
    if (etag === null || !strongEtag.test(etag)) {
      throw new Error('Cloud control response requires a strong ETag. R2 returned a missing, weak or invalid validator.');
    }
    const savedAt = Date.parse(response.headers.get('last-modified'));
    if (!Number.isFinite(savedAt)) {
      throw new Error('Cloud control response did not supply a valid Last-Modified date.');
    }
    const value = JSON.parse(await response.text());
    if (value?.version !== 1 || !isId(value.change) || (value.head !== null && !isId(value.head))) {
      throw new Error('Invalid cloud control object.');
    }
    return { exists: true, head: value.head, etag, savedAt, now };
  }

  /**
   * @param {{exists: boolean, etag: ?string}} control
   * @param {string} head
   * @param {{signal?: AbortSignal}} attempt
   * @returns {Promise<boolean>}
   * @throws {Error}
   */
  async setHead(control, head, attempt = {}) {
    if (!isId(head)) {
      throw new Error(`Invalid cloud head: ${JSON.stringify(head)}`);
    }
    const body = JSON.stringify({ version: 1, change: randomUUID(), head, lease: null });
    const condition = control.exists ? { match: control.etag } : { absent: true };
    const response = await this.#send('PUT', controlKey, SyncSettings.ControlTimeoutMs, attempt, { body, ...condition });
    if (response.status === 409 || response.status === 412) {
      return false;
    }
    if (!response.ok) {
      throw failure('Cloud control update', response);
    }
    return true;
  }

  /**
   * @param {{signal?: AbortSignal}} attempt
   * @returns {Promise<boolean>}
   * @throws {Error}
   */
  async hasForeignObjects(attempt = {}) {
    const response = await this.#send('GET', '', SyncSettings.ControlTimeoutMs, attempt, { list: true, folders: true });
    if (!response.ok) {
      throw failure('Cloud bucket listing', response);
    }
    const text = await response.text();
    if (!/<ListBucketResult[\s>]/.test(text)) {
      throw new Error('Cloud bucket listing was not a bucket listing.');
    }
    const prefixes = [...text.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]*)<\/Prefix>\s*<\/CommonPrefixes>/g)].map((match) => match[1]);
    const contents = text.match(/<Contents>/g) ?? [];
    return contents.length + prefixes.filter((folder) => folder !== universeFolder).length > 0;
  }

  /**
   * @param {string} id
   * @param {{signal?: AbortSignal}} attempt
   * @returns {Promise<{id: string, parent: ?string, files: Array<{path: string, hash: string, size?: number}>}>}
   * @throws {Error}
   */
  async manifest(id, attempt = {}) {
    if (!isId(id)) {
      throw new Error(`Invalid cloud manifest id: ${JSON.stringify(id)}`);
    }
    const bytes = await this.#read(`${prefix}/manifests/${id}.json`, SyncSettings.ObjectTimeoutMs, attempt);
    const value = JSON.parse(bytes.toString('utf8'));
    if (![1, 2].includes(value?.version) || value.id !== id ||
        (value.parent !== null && (!isId(value.parent) || value.parent === id))) {
      throw new Error(`Invalid cloud manifest: ${id}`);
    }
    return { id, parent: value.parent, files: SyncScope.entries(value.files) };
  }

  /**
   * @param {{id: string, parent: ?string, files: Array<{path: string, hash: string, size?: number}>}} manifest
   * @param {{signal?: AbortSignal}} attempt
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async putManifest(manifest, attempt = {}) {
    const files = manifest.files.map((entry) => (entry.size === undefined ?
      { path: entry.path, hash: entry.hash } :
      { path: entry.path, hash: entry.hash, size: entry.size }));
    if (!isId(manifest.id) || (manifest.parent !== null && !isId(manifest.parent)) || manifest.parent === manifest.id ||
        SyncScope.entries(files).length !== files.length) {
      throw new Error(`Refusing to upload an invalid cloud manifest: ${JSON.stringify(manifest.id)}`);
    }
    const body = Buffer.from(JSON.stringify({ version: 2, id: manifest.id, parent: manifest.parent, files }));
    const key = `${prefix}/manifests/${manifest.id}.json`;
    if (!(await this.#put(key, body, SyncSettings.ObjectTimeoutMs, attempt)) &&
        !(await this.#read(key, SyncSettings.ObjectTimeoutMs, attempt)).equals(body)) {
      throw new Error(`Cloud manifest ${manifest.id} already exists with different content.`);
    }
  }

  /**
   * @param {string} hash
   * @param {?number} size
   * @param {{signal?: AbortSignal}} attempt
   * @returns {Promise<Buffer>}
   * @throws {Error}
   */
  async blob(hash, size = null, attempt = {}) {
    const sized = Number.isSafeInteger(size) && size >= 0;
    const bytes = await this.#read(`${prefix}/blobs/${hash}`, sized ? sizedTimeoutMs(size) : SyncSettings.ObjectTimeoutMs, attempt,
      sized ? {} : { bodyTimeoutMs });
    if (digest(bytes) !== hash) {
      throw new Error(`Cloud blob ${hash} failed its integrity check.`);
    }
    return bytes;
  }

  /**
   * @param {string} hash
   * @param {Buffer} bytes
   * @param {{signal?: AbortSignal}} attempt
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async putBlob(hash, bytes, attempt = {}) {
    if (digest(bytes) !== hash) {
      throw new Error(`Blob bytes do not match hash ${hash}.`);
    }
    await this.#put(`${prefix}/blobs/${hash}`, bytes, sizedTimeoutMs(bytes.length), attempt);
  }

  /**
   * @param {?string} head
   * @param {string} id
   * @param {{signal?: AbortSignal, read?: Function}} options
   * @returns {Promise<boolean>}
   * @throws {Error}
   */
  async hasAncestor(head, id, { signal, read = (current) => this.manifest(current, { signal }) } = {}) {
    const visited = new Set();
    let current = head;
    for (let step = 0; step < SyncSettings.AncestorLimit; step += 1) {
      if (current === null || visited.has(current)) {
        return false;
      }
      visited.add(current);
      current = (await read(current)).parent;
      if (current !== null && current === id) {
        return true;
      }
    }
    return false;
  }

  /**
   * @param {string} key
   * @param {number} timeoutMs
   * @param {{signal?: AbortSignal}} attempt
   * @param {object} request
   * @returns {Promise<Buffer>}
   * @throws {Error}
   */
  async #read(key, timeoutMs, attempt, request = {}) {
    const response = await this.#send('GET', key, timeoutMs, attempt, request);
    if (!response.ok) {
      throw failure(`Cloud read of ${key}`, response);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * @param {string} key
   * @param {Buffer} body
   * @param {number} timeoutMs
   * @param {{signal?: AbortSignal}} attempt
   * @returns {Promise<boolean>}
   * @throws {Error}
   */
  async #put(key, body, timeoutMs, attempt) {
    const response = await this.#send('PUT', key, timeoutMs, attempt, { body, absent: true });
    if (response.status === 409 || response.status === 412) {
      return false;
    }
    if (!response.ok) {
      throw failure(`Cloud upload of ${key}`, response);
    }
    return true;
  }

  /**
   * @param {string} method
   * @param {string} key
   * @param {number} timeoutMs
   * @param {{signal?: AbortSignal}} attempt
   * @param {object} request
   * @returns {Promise<Response>}
   * @throws {Error}
   */
  #send(method, key, timeoutMs, { signal }, request = {}) {
    return this.#transport(method, key, { ...request, timeoutMs: Math.min(timeoutMs, SyncSettings.MaxTimerMs), signal });
  }
}
