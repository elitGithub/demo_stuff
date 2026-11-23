import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { FileErrors } from './FileErrors.mjs';
import { ProfileScan } from './ProfileScan.mjs';
import { Retry } from './Retry.mjs';
import { SaveOutcome } from './SaveOutcome.mjs';
import { SaveReason } from './SaveReason.mjs';
import { SyncPhase } from './SyncPhase.mjs';
import { SyncSettings } from './SyncSettings.mjs';
import { SyncState } from './SyncState.mjs';

const unsettledHash = Symbol('unsettled');
const foreignBucket = 'The bucket holds other objects but no Universe save, so cloud sync is off.';
const stoppedEarly = 'Stopped before the save finished';
const stoppedPull = 'Stopped before the pull finished. The next start continues it.';

/**
 * @param {Array<{path: string, hash: string, size?: number}>} files
 * @returns {Map<string, {hash: string, size?: number}>}
 */
function entryMap(files) {
  return new Map(files.map(({ path, ...entry }) => [path, entry]));
}

/**
 * @param {string} path
 * @returns {string[]}
 */
function ancestors(path) {
  const found = [];
  for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
    found.push(path.slice(0, slash));
  }
  return found;
}

export class ProfileSync {
  #dataRoot;
  #stateRoot;
  #bucket;
  #cloud;
  #clock;
  #onStatus;
  #base = null;
  #pending = null;
  #running = null;
  #queued = null;
  #queuedRequest = null;
  #halt = null;
  #conflict = null;
  #disabled = null;
  #aside = null;
  #cleanAt = null;
  #carriedFailure = null;
  #status = {
    phase: SyncPhase.Pulling, progress: null, lastSavedAt: null, unsavedSince: null, error: null, conflictAt: null, conflictsFolder: null, reloadTabs: false,
  };

  /**
   * @param {{dataRoot: string, stateRoot: string, bucket: string, cloud: object, clock: {now: Function, sleep: Function}, onStatus: Function}} options
   */
  constructor({ dataRoot, stateRoot, bucket, cloud, clock, onStatus }) {
    this.#dataRoot = dataRoot;
    this.#stateRoot = stateRoot;
    this.#bucket = bucket;
    this.#cloud = cloud;
    this.#clock = clock;
    this.#onStatus = onStatus;
  }

  /**
   * @param {{signal?: AbortSignal}} options
   * @returns {Promise<{changedFiles: number, offline: boolean, disabled: ?string}>}
   * @throws {Error}
   */
  async start({ signal } = {}) {
    try {
      this.#report({ phase: SyncPhase.Pulling });
      await fs.mkdir(this.#stateRoot, { recursive: true });
      const probe = join(this.#stateRoot, SyncSettings.CaseProbeFile);
      await fs.writeFile(probe, '');
      const original = await fs.lstat(probe);
      const twin = await FileErrors.missing(fs.lstat(join(this.#stateRoot, SyncSettings.CaseProbeFile.toUpperCase())));
      if (twin !== null && twin.ino === original.ino && twin.dev === original.dev) {
        return this.#disable('The Universe data folder is on a case-insensitive filesystem, so cloud sync is off.');
      }
      const state = await SyncState.read(this.#stateRoot, this.#bucket);
      if (state !== null && Object.hasOwn(state, 'mismatch')) {
        return this.#disable(`This PC last synced with bucket ${state.mismatch}, not the configured ${this.#bucket}, so cloud sync is off.`);
      }
      const unknown = { revision: null, files: new Map() };
      let base = state === null ? unknown :
        { revision: state.revision, files: state.files === null ? null : new Map(Object.entries(state.files)) };
      const pending = state?.pending ? { revision: state.pending.id, files: new Map(Object.entries(state.pending.files)) } : null;
      const local = await ProfileScan.scan(this.#dataRoot, state?.files ?? {}, this.#clock);
      const emptyLocal = local.blocked === null && local.files.size === 0 && local.unsettled.length === 0;
      const contact = { failedAt: null, giveUpMs: SyncSettings.StartContactMs, signal };
      let control;
      try {
        control = await this.#call((attempt) => this.#cloud.readControl(attempt), contact);
        if (!control.exists && await this.#call((attempt) => this.#cloud.hasForeignObjects(attempt), contact)) {
          return this.#disable(foreignBucket);
        }
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        if (!Retry.retryable(error)) {
          return this.#disable(error.message);
        }
        this.#base = base.files === null || (emptyLocal && base.files.size > 0) ? unknown : base;
        this.#pending = pending;
        this.#cleanAt = this.#now();
        this.#report({ phase: SyncPhase.Offline, error: `Cloud unreachable: not pulled. ${error.message}` });
        return { changedFiles: 0, offline: true, disabled: null };
      }
      const watch = { failedAt: null, giveUpMs: SyncSettings.TransferGiveUpMs, signal };
      const head = control.head;
      if (pending !== null && head !== null && (head === pending.revision ||
          await this.#at(`cloud manifest ${head}`, () => this.#hasAncestor(head, pending.revision, watch)))) {
        base = pending;
      }
      if (base.files === null) {
        const revision = base.revision;
        const manifest = await this.#at(`cloud manifest ${revision}`, () => this.#call((attempt) => this.#cloud.manifest(revision, attempt), watch));
        base = { revision, files: entryMap(manifest.files) };
      }
      if (emptyLocal && base.files.size > 0) {
        base = unknown;
      }
      let target = head === null ? new Map() : base.files;
      const changed = new Set();
      const downloads = [];
      if (head !== null && head !== base.revision) {
        target = entryMap((await this.#at(`cloud manifest ${head}`, () => this.#call((attempt) => this.#cloud.manifest(head, attempt), watch))).files);
        if (local.blocked !== null) {
          throw new Error(`Pull stopped at ${local.blocked}: not a regular file or folder.`);
        }
        await fs.mkdir(this.#dataRoot, { recursive: true });
        const secret = join(this.#dataRoot, SyncSettings.CookieSecretFile);
        await this.#at(SyncSettings.CookieSecretFile, () => this.#place(secret, randomBytes(64).toString('base64'), 0o600));
        const unsettled = new Set(local.unsettled);
        const folders = new Set([...target.keys()].flatMap(ancestors));
        for (const path of new Set([...local.files.keys(), ...unsettled, ...target.keys()])) {
          const mine = unsettled.has(path) ? unsettledHash : local.files.get(path)?.hash ?? null;
          const theirs = target.get(path)?.hash ?? null;
          const last = base.files.get(path)?.hash ?? null;
          const blocking = folders.has(path) || ancestors(path).some((folder) => target.has(folder));
          if (mine === theirs || (mine !== null && theirs === last && (last === null || mine === unsettledHash) && !blocking)) {
            continue;
          }
          changed.add(path);
          if (mine !== null && mine !== last) {
            await this.#at(path, () => this.#moveAside(path));
          } else if (mine !== null && theirs === null) {
            await this.#at(path, () => fs.rm(join(this.#dataRoot, path), { force: true }));
          }
          if (theirs !== null) {
            downloads.push({ path, ...target.get(path) });
          }
        }
        const emptied = [...new Set([...changed].flatMap(ancestors))];
        emptied.sort((left, right) => right.split('/').length - left.split('/').length);
        for (const folder of emptied) {
          await this.#at(folder, () => FileErrors.tolerate(fs.rmdir(join(this.#dataRoot, folder)), ['ENOENT', 'ENOTDIR', 'ENOTEMPTY', 'EEXIST']));
        }
        await this.#pool(downloads, (item, signal) => this.#at(item.path, async () => {
          const bytes = await this.#call((attempt) => this.#cloud.blob(item.hash, item.size, attempt), watch, signal);
          const destination = join(this.#dataRoot, item.path);
          if ((await FileErrors.missing(fs.lstat(destination)))?.isDirectory()) {
            await this.#moveAside(item.path);
          }
          await fs.mkdir(dirname(destination), { recursive: true });
          await this.#place(destination, bytes);
        }), signal);
        this.#status.reloadTabs = true;
      }
      const files = new Map([...target].map(([path, entry]) => {
        const seen = local.files.get(path);
        return [path, !changed.has(path) && seen?.hash === entry.hash ? seen : entry];
      }));
      await this.#commit({ revision: head, files }, null);
      this.#cleanAt = this.#now();
      this.#report({ phase: SyncPhase.Running, error: null });
      return { changedFiles: changed.size, offline: false, disabled: null };
    } catch (error) {
      if (signal?.aborted) {
        this.#report({ phase: SyncPhase.Stopped, progress: null, error: stoppedPull });
        throw new Error(stoppedPull, { cause: error });
      }
      this.#report({ phase: SyncPhase.Failed, progress: null, error: error.message });
      throw error;
    }
  }

  /**
   * @param {string} reason
   * @param {{signal?: AbortSignal}} options
   * @returns {Promise<{outcome: string, at: string, error: ?string}>}
   * @throws {Error}
   */
  async save(reason, { signal } = {}) {
    if (this.#running !== null) {
      this.#link(this.#halt, signal);
      if (this.#queued === null || reason === SaveReason.Stop) {
        this.#queuedRequest = { reason, signal };
      }
      this.#queued ??= this.#running.then(() => {
        const request = this.#queuedRequest;
        this.#queued = null;
        return this.save(request.reason, { signal: request.signal });
      });
      return this.#queued;
    }
    if (this.#disabled !== null) {
      return this.#ended(reason, SyncPhase.Disabled, { outcome: SaveOutcome.Blocked, at: this.#now(), error: this.#disabled });
    }
    if (this.#conflict !== null) {
      return this.#ended(reason, SyncPhase.Conflict, { outcome: SaveOutcome.Conflict, ...this.#conflict });
    }
    if (this.#base === null) {
      throw new Error('Cloud sync has not started.');
    }
    let finish;
    this.#running = new Promise((resolve) => {
      finish = resolve;
    });
    const halt = new AbortController();
    this.#halt = halt;
    this.#link(halt, signal);
    const resting = this.#status.phase === SyncPhase.Offline ? SyncPhase.Offline : SyncPhase.Running;
    const watch = { failedAt: null, giveUpMs: SyncSettings.TransferGiveUpMs, signal: halt.signal, lastFailure: this.#carriedFailure };
    this.#carriedFailure = null;
    let handOn = null;
    try {
      this.#report({ phase: reason === SaveReason.Stop ? SyncPhase.Stopping : SyncPhase.Saving });
      const control = await this.#call((attempt) => this.#cloud.readControl(attempt), watch);
      if (!control.exists && await this.#call((attempt) => this.#cloud.hasForeignObjects(attempt), watch)) {
        this.#disable(foreignBucket);
        return this.#ended(reason, SyncPhase.Disabled, { outcome: SaveOutcome.Blocked, at: this.#now(), error: foreignBucket });
      }
      if (control.head !== this.#base.revision && control.head === this.#pending?.revision) {
        await this.#commit(this.#pending, null);
      }
      if (control.head !== this.#base.revision) {
        return this.#ended(reason, SyncPhase.Conflict, this.#conflicted(control.savedAt ?? this.#clock.now()));
      }
      const base = this.#base;
      const scan = await ProfileScan.scan(this.#dataRoot, Object.fromEntries(base.files), this.#clock);
      if (scan.blocked !== null || (scan.files.size === 0 && base.files.size > 0)) {
        const error = scan.blocked === null ? 'Not saved: the data folder holds no files.' : `Save stopped at ${scan.blocked}: not a regular file or folder.`;
        return this.#ended(reason, SyncPhase.Running, { outcome: SaveOutcome.Blocked, at: this.#now(), error });
      }
      const files = new Map(scan.files);
      const known = new Set([...base.files.values()].map((entry) => entry.hash));
      const uploads = [...files].filter(([, entry]) => !known.has(entry.hash)).map(([path, entry]) => ({ path, size: entry.size }));
      await this.#pool(uploads, async (item, poolSignal) => {
        const read = await ProfileScan.read(this.#dataRoot, item.path, this.#clock);
        let entry = base.files.get(item.path);
        if (read !== null) {
          if (!known.has(read.hash)) {
            await this.#call((attempt) => this.#cloud.putBlob(read.hash, read.bytes, attempt), watch, poolSignal);
          }
          entry = { hash: read.hash, size: read.size, mtimeMs: read.mtimeMs, hashedAtMs: read.hashedAtMs };
        } else if (await FileErrors.missing(fs.lstat(join(this.#dataRoot, item.path))) === null) {
          entry = undefined;
        }
        if (entry === undefined) {
          files.delete(item.path);
        } else {
          files.set(item.path, entry);
        }
      }, halt.signal);
      if (files.size === base.files.size && [...files].every(([path, entry]) => base.files.get(path)?.hash === entry.hash)) {
        if ([...files].some(([path, entry]) => base.files.get(path).mtimeMs !== entry.mtimeMs || base.files.get(path).hashedAtMs !== entry.hashedAtMs)) {
          await this.#commit({ revision: base.revision, files }, this.#pending);
        }
        this.#cleanAt = this.#now();
        return this.#ended(reason, SyncPhase.Running, { outcome: SaveOutcome.Unchanged, at: this.#cleanAt, error: null }, { unsavedSince: null });
      }
      const id = randomUUID();
      const entries = [...files].map(([path, entry]) => ({ path, hash: entry.hash, size: entry.size }));
      await this.#call((attempt) => this.#cloud.putManifest({ id, parent: base.revision, files: entries }, attempt), watch);
      await this.#commit(base, { revision: id, files });
      if (!(await this.#call((attempt) => this.#cloud.setHead(control, id, attempt), watch))) {
        const after = await this.#call((attempt) => this.#cloud.readControl(attempt), watch);
        if (after.head !== id) {
          if (await this.#hasAncestor(after.head, id, watch)) {
            await this.#commit(this.#pending, null);
          }
          return this.#ended(reason, SyncPhase.Conflict, this.#conflicted(after.savedAt ?? this.#clock.now()));
        }
      }
      await this.#commit({ revision: id, files }, null);
      this.#cleanAt = this.#now();
      return this.#ended(reason, SyncPhase.Running, { outcome: SaveOutcome.Saved, at: this.#cleanAt, error: null }, {
        lastSavedAt: this.#cleanAt, unsavedSince: null,
      });
    } catch (error) {
      const unsavedSince = this.#status.unsavedSince ?? this.#cleanAt;
      const stopped = watch.lastFailure === null ? `${stoppedEarly}.` : `${stoppedEarly}: ${watch.lastFailure}`;
      const message = halt.signal.aborted ? stopped : `Not saved since ${unsavedSince}: ${error.message}`;
      handOn = halt.signal.aborted ? watch.lastFailure : null;
      return this.#ended(reason, resting, { outcome: SaveOutcome.Failed, at: this.#now(), error: message }, { unsavedSince });
    } finally {
      this.#running = null;
      this.#carriedFailure = this.#queued === null ? null : handOn;
      finish();
    }
  }

  /**
   * @returns {string}
   * @throws {Error}
   */
  #now() {
    return new Date(this.#clock.now()).toISOString();
  }

  /**
   * @param {object} changes
   * @returns {void}
   * @throws {Error}
   */
  #report(changes) {
    Object.assign(this.#status, changes);
    this.#onStatus({ ...this.#status });
  }

  /**
   * @param {string} reason
   * @returns {{changedFiles: number, offline: boolean, disabled: string}}
   * @throws {Error}
   */
  #disable(reason) {
    this.#disabled = reason;
    this.#report({ phase: SyncPhase.Disabled, error: reason });
    return { changedFiles: 0, offline: false, disabled: reason };
  }

  /**
   * @param {number} savedAt
   * @returns {{outcome: string, at: string, error: string}}
   * @throws {RangeError}
   */
  #conflicted(savedAt) {
    const at = new Date(savedAt).toISOString();
    this.#conflict = {
      at,
      error: `The other PC saved newer changes at ${at}. This PC's changes stay here. Restart Universe to pull; every file this PC changed goes to local/conflicts first.`,
    };
    return { outcome: SaveOutcome.Conflict, ...this.#conflict };
  }

  /**
   * @param {string} reason
   * @param {string} phase
   * @param {{outcome: string, at: string, error: ?string}} result
   * @param {object} changes
   * @returns {{outcome: string, at: string, error: ?string}}
   * @throws {Error}
   */
  #ended(reason, phase, result, changes = {}) {
    this.#report({
      ...changes,
      progress: null,
      error: result.error,
      conflictAt: this.#conflict === null ? null : this.#conflict.at,
      phase: reason === SaveReason.Stop ? SyncPhase.Stopped : phase,
    });
    return result;
  }

  /**
   * @param {Function} operation
   * @param {{failedAt: ?number, giveUpMs: number, signal?: AbortSignal, lastFailure?: ?string}} watch
   * @param {AbortSignal} [signal]
   * @returns {Promise<*>}
   * @throws {Error}
   */
  #call(operation, watch, signal = watch.signal) {
    return Retry.run(operation, {
      giveUpMs: watch.giveUpMs,
      clock: this.#clock,
      signal,
      window: watch,
      /**
       * @param {{attempt: number, error: Error, nextMs: number}} wait
       * @returns {void}
       * @throws {Error}
       */
      onWait: (wait) => {
        watch.lastFailure = wait.error.message;
        this.#report({ error: `${wait.error.message} Retrying in ${Math.ceil(wait.nextMs / 1000)} s.` });
      },
    });
  }

  /**
   * @param {?string} head
   * @param {string} id
   * @param {{failedAt: ?number, giveUpMs: number, signal?: AbortSignal}} watch
   * @returns {Promise<boolean>}
   * @throws {Error}
   */
  #hasAncestor(head, id, watch) {
    return this.#cloud.hasAncestor(head, id, {
      /**
       * @param {string} current
       * @returns {Promise<{id: string, parent: ?string, files: Array<{path: string, hash: string, size?: number}>}>}
       * @throws {Error}
       */
      read: (current) => this.#call((attempt) => this.#cloud.manifest(current, attempt), watch),
    });
  }

  /**
   * @param {AbortController} halt
   * @param {AbortSignal | undefined} signal
   * @returns {void}
   */
  #link(halt, signal) {
    if (signal?.aborted) {
      halt.abort(signal.reason);
    }
    signal?.addEventListener('abort', () => halt.abort(signal.reason), { once: true });
  }

  /**
   * @param {string} label
   * @param {Function} operation
   * @returns {Promise<*>}
   * @throws {Error}
   */
  async #at(label, operation) {
    try {
      return await operation();
    } catch (error) {
      throw new Error(`Pull stopped at ${label}: ${error.message}`, { cause: error });
    }
  }

  /**
   * @param {string} path
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async #moveAside(path) {
    if (this.#aside === null) {
      const parent = join(dirname(this.#dataRoot), SyncSettings.ConflictsFolder);
      const stamp = new Date(this.#clock.now()).toISOString().replaceAll(':', '-').replace('.', '-');
      this.#aside = fs.mkdir(parent, { recursive: true }).then(async () => {
        let folder = null;
        for (let attempt = 1; folder === null; attempt += 1) {
          const candidate = join(parent, attempt === 1 ? stamp : `${stamp}-${attempt}`);
          folder = await FileErrors.tolerate(fs.mkdir(candidate).then(() => candidate), ['EEXIST']);
        }
        this.#report({ conflictsFolder: folder });
        return folder;
      });
    }
    const source = join(this.#dataRoot, path);
    const destination = join(await this.#aside, path);
    const existing = await FileErrors.missing(fs.lstat(destination));
    if (existing === null) {
      await fs.mkdir(dirname(destination), { recursive: true });
      await fs.rename(source, destination);
      return;
    }
    if (existing.isDirectory() && (await fs.lstat(source)).isDirectory()) {
      for (const name of await fs.readdir(source)) {
        await this.#moveAside(`${path}/${name}`);
      }
      await fs.rmdir(source);
      return;
    }
    const name = basename(destination);
    const dot = name.lastIndexOf('.');
    for (let copy = 2; ; copy += 1) {
      const candidate = join(dirname(destination), dot > 0 ? `${name.slice(0, dot)}-${copy}${name.slice(dot)}` : `${name}-${copy}`);
      if ((await FileErrors.missing(fs.lstat(candidate))) === null) {
        await fs.rename(source, candidate);
        return;
      }
    }
  }

  /**
   * @param {string} absolute
   * @param {Buffer | string} content
   * @param {number} [mode]
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async #place(absolute, content, mode = 0o666) {
    const temporary = `${absolute}.${randomInt(1_000_000_000)}`;
    const handle = await fs.open(temporary, 'wx', mode);
    try {
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, absolute);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  /**
   * @param {{revision: ?string, files: Map}} base
   * @param {?{revision: string, files: Map}} pending
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async #commit(base, pending) {
    await SyncState.write(this.#stateRoot, {
      bucket: this.#bucket,
      revision: base.revision,
      pending: pending === null ? null : { id: pending.revision, files: Object.fromEntries(pending.files) },
      files: Object.fromEntries(base.files),
    });
    this.#base = base;
    this.#pending = pending;
  }

  /**
   * @param {Array<{path: string, size?: number}>} items
   * @param {Function} task
   * @param {AbortSignal} [signal]
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async #pool(items, task, signal) {
    if (items.length === 0) {
      return;
    }
    const progress = { filesDone: 0, filesTotal: items.length, bytesDone: 0, bytesTotal: items.reduce((sum, item) => sum + (item.size ?? 0), 0) };
    this.#report({ progress: { ...progress } });
    const controller = new AbortController();
    const combined = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]);
    let next = 0;
    /**
     * @returns {Promise<void>}
     */
    const worker = async () => {
      while (next < items.length && !combined.aborted) {
        const item = items[next];
        next += 1;
        try {
          await task(item, combined);
          progress.filesDone += 1;
          progress.bytesDone += item.size ?? 0;
          this.#report({ progress: { ...progress } });
        } catch (error) {
          controller.abort(error);
        }
      }
    };
    await Promise.all(Array.from({ length: SyncSettings.Concurrency }, worker));
    this.#report({ progress: null });
    if (combined.aborted) {
      throw combined.reason;
    }
  }
}
