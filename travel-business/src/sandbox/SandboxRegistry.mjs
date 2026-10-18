import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, parse, resolve, sep } from 'node:path';
import { SandboxConfig } from '../dto/SandboxConfig.mjs';
import { SandboxRecord } from '../dto/SandboxRecord.mjs';
import { RateBucket } from '../dto/RateBucket.mjs';
import { Registry } from '../dto/Registry.mjs';
import { SandboxState } from '../enums/SandboxState.mjs';
import { ErrorCode } from '../enums/ErrorCode.mjs';
import { InputError } from '../InputError.mjs';

export class SandboxRegistry {
  /** @param {string} root @param {SandboxConfig} config */
  constructor(root, config) {
    if (typeof root !== 'string' || !root || !(config instanceof SandboxConfig)) { throw new TypeError('Explicit registry configuration is required.'); }
    this.root = resolve(root);
    this.config = config;
  }

  /** @returns {Registry} */
  load() {
    try {
      this.prepareRoot();
      const entries = this.entries(this.root, this.config.maxSandboxes + 3);
      if (entries.length === 0) {
        closeSync(openSync(join(this.root, 'runtime.lock'), 'wx', 0o600));
        const registry = new Registry({ sandboxes: new Map(), rateBuckets: new Map() });
        this.save(registry);
        return registry;
      }
      if (!entries.includes('registry.json') || !entries.includes('runtime.lock')) { throw new TypeError('Incomplete runtime metadata.'); }
      this.file(join(this.root, 'registry.json'), 1048576);
      const encoded = readFileSync(join(this.root, 'registry.json'), 'utf8');
      const raw = JSON.parse(encoded);
      if (!this.shape(raw, ['version', 'sandboxes', 'rateBuckets']) || raw.version !== 1 || !this.object(raw.sandboxes) || !this.object(raw.rateBuckets) || Object.keys(raw.sandboxes).length > this.config.maxSandboxes || Object.keys(raw.rateBuckets).length > this.config.maxRateBuckets || JSON.stringify(raw) !== encoded) { throw new TypeError('Invalid registry shape.'); }
      const sandboxes = new Map();
      const contexts = new Set();
      const authorizations = new Set();
      for (const [key, record] of Object.entries(raw.sandboxes)) {
        if (!this.shape(record, ['digest', 'csrfToken', 'dashboardDigest', 'lastActivity', 'state']) || key !== record.digest || !Number.isSafeInteger(record.lastActivity + this.config.idleSeconds) || contexts.has(record.csrfToken) || (record.dashboardDigest !== null && authorizations.has(record.dashboardDigest)) || (record.state !== SandboxState.Ready.value && record.dashboardDigest !== null)) { throw new TypeError('Invalid registry sandbox.'); }
        sandboxes.set(key, new SandboxRecord({ ...record, state: SandboxState.from(record.state) }));
        contexts.add(record.csrfToken);
        if (record.dashboardDigest !== null) { authorizations.add(record.dashboardDigest); }
      }
      const rateBuckets = new Map();
      for (const [key, bucket] of Object.entries(raw.rateBuckets)) {
        if (!this.shape(bucket, ['key', 'hits', 'expiresAt']) || key !== bucket.key || bucket.hits > Math.max(this.config.allocationLimit, this.config.enquiryLimit, this.config.loginLimit)) { throw new TypeError('Invalid registry rate bucket.'); }
        rateBuckets.set(key, new RateBucket(bucket));
      }
      const registry = new Registry({ version: raw.version, sandboxes, rateBuckets });
      this.extraBytes(registry);
      return registry;
    } catch (error) { throw this.unavailable(error); }
  }

  /** @param {Registry} registry @returns {void} */
  save(registry) {
    let descriptor;
    try {
      if (!(registry instanceof Registry) || registry.sandboxes.size > this.config.maxSandboxes || registry.rateBuckets.size > this.config.maxRateBuckets) { throw new TypeError('Invalid registry bounds.'); }
      this.prepareRoot();
      const encoded = JSON.stringify(registry);
      if (Buffer.byteLength(encoded) > 1048576) { throw new TypeError('Registry exceeds its image limit.'); }
      for (const name of ['registry.json', 'registry.next']) {
        const path = join(this.root, name);
        try { this.file(path, 1048576); } catch (error) { if (error.code !== 'ENOENT') { throw error; } }
      }
      descriptor = openSync(join(this.root, 'registry.next'), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
      writeFileSync(descriptor, encoded);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(join(this.root, 'registry.next'), join(this.root, 'registry.json'));
      descriptor = openSync(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      fsyncSync(descriptor);
    } catch (error) { throw this.unavailable(error); }
    finally { if (descriptor !== undefined) { closeSync(descriptor); } }
  }

  /** @param {Registry} registry @returns {number} */
  extraBytes(registry) {
    try {
      this.prepareRoot();
      const records = registry.sandboxes;
      const directories = new Set();
      let extra = 0;
      for (const name of this.entries(this.root, this.config.maxSandboxes + 3)) {
        if (['registry.json', 'registry.next', 'runtime.lock'].includes(name)) {
          this.file(join(this.root, name), name === 'runtime.lock' ? 0 : 1048576);
          continue;
        }
        if (!/^[a-f0-9]{64}$/.test(name) || !records.has(name)) { throw new TypeError('Unknown runtime entry.'); }
        directories.add(name);
        extra += this.inspect(records.get(name));
      }
      for (const record of records.values()) {
        if (record.state === SandboxState.Ready && !directories.has(record.digest)) { throw new TypeError('Missing ready sandbox.'); }
      }
      return extra;
    } catch (error) { throw this.unavailable(error); }
  }

  /** @param {SandboxRecord} record @returns {void} */
  remove(record) {
    try {
      if (!(record instanceof SandboxRecord) || record.state !== SandboxState.Failed) { throw new TypeError('Only failed allocations may be removed.'); }
      this.prepareRoot();
      const directory = join(this.root, record.digest);
      try { lstatSync(directory); } catch (error) { if (error.code === 'ENOENT') { return; } throw error; }
      this.inspect(record);
      for (const name of this.entries(directory, 4)) { unlinkSync(join(directory, name)); }
      rmdirSync(directory);
    } catch (error) { throw this.unavailable(error); }
  }

  /** @returns {void} */
  prepareRoot() {
    let directory = parse(this.root).root;
    for (const component of this.root.slice(directory.length).split(sep).filter(Boolean)) {
      directory = join(directory, component);
      try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') { throw error; } }
      const information = lstatSync(directory);
      if (!information.isDirectory() || information.isSymbolicLink() || (directory === this.root && (information.mode & 0o077) !== 0)) { throw new TypeError('Unsafe runtime path.'); }
    }
  }

  /** @param {SandboxRecord} record @returns {number} */
  inspect(record) {
    const directory = join(this.root, record.digest);
    const information = lstatSync(directory);
    if (!information.isDirectory() || information.isSymbolicLink() || (information.mode & 0o077) !== 0) { throw new TypeError('Unsafe sandbox directory.'); }
    let main = false;
    let extra = 0;
    for (const name of this.entries(directory, 4)) {
      if (!['demo.sqlite', 'seed.sqlite', 'demo.sqlite-journal', 'seed.sqlite-journal'].includes(name)) { throw new TypeError('Unknown sandbox artifact.'); }
      const maximum = name.endsWith('-journal') ? this.config.journalReserveBytes : this.config.maxDatabaseBytes;
      const bytes = this.file(join(directory, name), maximum);
      if (name === 'demo.sqlite') { main = true; } else { extra += bytes; }
    }
    if (record.state === SandboxState.Ready && !main) { throw new TypeError('Missing ready database.'); }
    return extra;
  }

  /** @param {string} directory @param {number} limit @returns {string[]} */
  entries(directory, limit) {
    const handle = opendirSync(directory);
    const names = [];
    try {
      let entry;
      while ((entry = handle.readSync()) !== null) {
        if (names.length >= limit) { throw new TypeError('Too many runtime entries.'); }
        names.push(entry.name);
      }
    } finally { handle.closeSync(); }
    return names;
  }

  /** @param {string} path @param {number} maximum @returns {number} */
  file(path, maximum) {
    const information = lstatSync(path);
    if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1 || information.size > maximum || (information.mode & 0o077) !== 0) { throw new TypeError('Unsafe runtime file.'); }
    return information.size;
  }

  /** @param {unknown} value @returns {boolean} */
  object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  /** @param {unknown} value @param {string[]} fields @returns {boolean} */
  shape(value, fields) { return this.object(value) && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)); }
  /** @param {Error} cause @returns {InputError} */
  unavailable(cause) {
    if (cause instanceof InputError) { return cause; }
    const error = new InputError('The demo storage is unavailable.', 503, ErrorCode.Unavailable);
    Object.defineProperty(error, 'cause', { value: cause, configurable: true });
    return error;
  }
}
