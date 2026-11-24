import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteStore } from '../store/SqliteStore.mjs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;
const SQLITE_HEADER_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');
const STRONG_ETAG_REGEX = /^"[\x21\x23-\x7e\x80-\xff]*"$/;
const DEFAULT_PULL_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_SNAPSHOTS = 30;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class WorldSync {
  #transport;
  #bucket;
  #prefix;
  #allowedRootFolder;
  #pullTimeoutMs;
  #maxSnapshots;
  #maxAgeMs;
  #clock;
  #uuidGenerator;
  #storeFactory;
  #pushQueue = Promise.resolve();
  #status;

  /**
   * @param {{transport: object, bucket?: string, prefix?: string, pullTimeoutMs?: number, maxSnapshots?: number, maxAgeMs?: number, clock?: Function, uuidGenerator?: Function, storeFactory?: Function}} options
   * @throws {Error}
   */
  constructor({
    transport,
    bucket,
    prefix = '_worlds/v1',
    pullTimeoutMs = DEFAULT_PULL_TIMEOUT_MS,
    maxSnapshots = DEFAULT_MAX_SNAPSHOTS,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    clock = () => Date.now(),
    uuidGenerator = () => randomUUID(),
    storeFactory = (filePath) => new SqliteStore(filePath),
  } = {}) {
    if (
      transport === null
      || typeof transport !== 'object'
      || typeof transport.hasForeignObjects !== 'function'
      || typeof transport.listObjects !== 'function'
      || typeof transport.getObject !== 'function'
      || typeof transport.putObject !== 'function'
      || typeof transport.deleteObject !== 'function'
    ) {
      throw new Error('WorldSync requires a transport implementing R2Transport methods.');
    }
    const resolvedBucket = bucket ?? transport.bucket;
    if (typeof resolvedBucket !== 'string' || !BUCKET_NAME_REGEX.test(resolvedBucket)) {
      throw new Error('WorldSync requires a valid bucket name.');
    }
    if (typeof prefix !== 'string' || prefix.length === 0 || prefix.startsWith('/') || prefix.endsWith('/')) {
      throw new Error('WorldSync prefix must be a non-empty relative key prefix without leading/trailing slashes.');
    }
    const rootSegment = prefix.split('/')[0];
    if (rootSegment !== '_worlds') {
      throw new Error('WorldSync prefix must live under _worlds/.');
    }
    if (!Number.isFinite(pullTimeoutMs) || pullTimeoutMs <= 0) {
      throw new Error('WorldSync pullTimeoutMs must be a positive finite number.');
    }
    if (!Number.isSafeInteger(maxSnapshots) || maxSnapshots < 1) {
      throw new Error('WorldSync maxSnapshots must be a positive integer.');
    }
    if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
      throw new Error('WorldSync maxAgeMs must be a non-negative finite number.');
    }
    if (typeof clock !== 'function' || typeof uuidGenerator !== 'function' || typeof storeFactory !== 'function') {
      throw new Error('WorldSync clock, uuidGenerator, and storeFactory must be functions.');
    }
    this.#transport = transport;
    this.#bucket = resolvedBucket;
    this.#prefix = prefix;
    this.#allowedRootFolder = `${rootSegment}/`;
    this.#pullTimeoutMs = Math.ceil(pullTimeoutMs);
    this.#maxSnapshots = maxSnapshots;
    this.#maxAgeMs = maxAgeMs;
    this.#clock = clock;
    this.#uuidGenerator = uuidGenerator;
    this.#storeFactory = storeFactory;
    this.#status = {
      mode: 'r2',
      status: 'pending',
      bucket: this.#bucket,
      head: null,
      offline: false,
      warning: null,
      conflictBackupPath: null,
    };
  }

  /**
   * @returns {{mode: string, status: string, bucket: string, head: ?string, offline: boolean, warning: ?string, conflictBackupPath: ?string}}
   */
  getStatus() {
    return { ...this.#status };
  }

  /**
   * @param {{signal?: AbortSignal}} options
   * @returns {Promise<boolean>}
   * @throws {Error}
   */
  async hasForeignObjects({ signal } = {}) {
    return this.#transport.hasForeignObjects({
      allowedPrefix: this.#allowedRootFolder,
      timeoutMs: this.#pullTimeoutMs,
      signal,
    });
  }

  /**
   * @param {{dbPath: string, syncStatePath: string, conflictsDir: string, signal?: AbortSignal}} options
   * @returns {Promise<{mode: string, status: string, bucket: string, head: ?string, offline: boolean, warning: ?string, conflictBackupPath: ?string}>}
   * @throws {Error}
   */
  async pullOnStartup({ dbPath, syncStatePath, conflictsDir, signal } = {}) {
    if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
      throw new Error('pullOnStartup requires a non-empty dbPath.');
    }
    if (typeof syncStatePath !== 'string' || syncStatePath.trim().length === 0) {
      throw new Error('pullOnStartup requires a non-empty syncStatePath.');
    }
    if (typeof conflictsDir !== 'string' || conflictsDir.trim().length === 0) {
      throw new Error('pullOnStartup requires a non-empty conflictsDir.');
    }
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
    }

    const localState = this.#readLocalState(syncStatePath);
    const localDbExists = fs.existsSync(dbPath);

    const startupController = new AbortController();
    let timedOut = false;
    const timeoutSignal = AbortSignal.timeout(this.#pullTimeoutMs);
    const onTimeout = () => {
      timedOut = true;
      startupController.abort(timeoutSignal.reason ?? new Error(`R2 startup pull timed out after ${this.#pullTimeoutMs}ms.`));
    };
    timeoutSignal.addEventListener('abort', onTimeout, { once: true });
    let onParentAbort = null;
    if (signal !== undefined) {
      onParentAbort = () => {
        startupController.abort(signal.reason);
      };
      signal.addEventListener('abort', onParentAbort, { once: true });
    }

    let hasForeign = false;
    let remoteControl = null;
    try {
      try {
        hasForeign = await this.#transport.hasForeignObjects({
          allowedPrefix: this.#allowedRootFolder,
          timeoutMs: this.#pullTimeoutMs,
          signal: startupController.signal,
        });
        if (!hasForeign) {
          remoteControl = await this.#readRemoteControl(startupController.signal);
        }
      } catch (error) {
        if (signal?.aborted) {
          throw error;
        }
        const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : null;
        const networkCode = error?.code ?? error?.cause?.code ?? null;
        const isTransient = timedOut
          || error?.name === 'TimeoutError'
          || error?.name === 'TypeError'
          || (statusCode !== null && (statusCode >= 500 || statusCode === 429))
          || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(networkCode);
        if (!error?.isSyncDomainError && isTransient) {
          if (localDbExists) {
            this.#status = {
              mode: 'r2',
              status: 'offline',
              bucket: this.#bucket,
              head: localState?.head ?? null,
              offline: true,
              warning: `R2 unreachable during startup (${error.message}); continuing in local mode.`,
              conflictBackupPath: null,
            };
            return this.getStatus();
          }
          throw new Error(`R2 unreachable during startup and no local database exists at ${dbPath}: ${error.message}`, { cause: error });
        }
        throw error;
      }
    } finally {
      timeoutSignal.removeEventListener('abort', onTimeout);
      if (onParentAbort !== null && signal !== undefined) {
        signal.removeEventListener('abort', onParentAbort);
      }
    }

    if (hasForeign) {
      const foreignError = this.#domainError('Refusing sync: R2 bucket contains non-Worlds objects outside _worlds/.');
      this.#status = {
        mode: 'r2',
        status: 'error',
        bucket: this.#bucket,
        head: localState?.head ?? null,
        offline: false,
        warning: foreignError.message,
        conflictBackupPath: null,
      };
      throw foreignError;
    }

    this.#assertSameBucketAndLineage(localState, remoteControl);

    if (!remoteControl.exists) {
      const bucketToken = this.#uuidGenerator();
      const nowIso = new Date(this.#clock()).toISOString();
      const initialBody = JSON.stringify({
        version: 1,
        bucketToken,
        change: this.#uuidGenerator(),
        head: null,
        updatedAt: nowIso,
      });
      const initResult = await this.#transport.putObject(`${this.#prefix}/control.json`, initialBody, {
        contentType: 'application/json',
        ifNoneMatch: '*',
        timeoutMs: this.#pullTimeoutMs,
        signal,
      });
      if (initResult.preconditionFailed) {
        remoteControl = await this.#readRemoteControl(signal);
        if (!remoteControl.exists) {
          throw this.#domainError('Concurrent control.json conflict could not be resolved because control.json is still missing.');
        }
        this.#assertSameBucketAndLineage(localState, remoteControl);
      } else {
        this.#writeLocalState(syncStatePath, {
          version: 1,
          bucket: this.#bucket,
          bucketToken,
          head: null,
          etag: initResult.etag ?? null,
          syncedChangeSeq: 0,
          pendingHead: null,
          pendingSeq: null,
          updatedAt: nowIso,
        });
        this.#status = {
          mode: 'r2',
          status: 'initialized',
          bucket: this.#bucket,
          head: null,
          offline: false,
          warning: null,
          conflictBackupPath: null,
        };
        return this.getStatus();
      }
    }

    if (localState !== null && localState.pendingHead !== null && remoteControl.data.head === localState.pendingHead) {
      const recoveredSeq = localState.pendingSeq !== null ? localState.pendingSeq : localState.syncedChangeSeq;
      const nowIso = new Date(this.#clock()).toISOString();
      this.#writeLocalState(syncStatePath, {
        version: 1,
        bucket: this.#bucket,
        bucketToken: remoteControl.data.bucketToken,
        head: remoteControl.data.head,
        etag: remoteControl.etag,
        syncedChangeSeq: recoveredSeq,
        pendingHead: null,
        pendingSeq: null,
        updatedAt: nowIso,
      });
      this.#status = {
        mode: 'r2',
        status: 'recovered',
        bucket: this.#bucket,
        head: remoteControl.data.head,
        offline: false,
        warning: null,
        conflictBackupPath: null,
      };
      return this.getStatus();
    }

    if (remoteControl.data.head === null) {
      const nowIso = new Date(this.#clock()).toISOString();
      this.#writeLocalState(syncStatePath, {
        version: 1,
        bucket: this.#bucket,
        bucketToken: remoteControl.data.bucketToken,
        head: null,
        etag: remoteControl.etag,
        syncedChangeSeq: localState?.syncedChangeSeq ?? 0,
        pendingHead: null,
        pendingSeq: null,
        updatedAt: nowIso,
      });
      this.#status = {
        mode: 'r2',
        status: 'ready',
        bucket: this.#bucket,
        head: null,
        offline: false,
        warning: null,
        conflictBackupPath: null,
      };
      return this.getStatus();
    }

    const remoteHead = remoteControl.data.head;
    if (localDbExists && localState !== null && localState.head === remoteHead) {
      const nowIso = new Date(this.#clock()).toISOString();
      if (localState.pendingHead !== null || localState.etag !== remoteControl.etag) {
        this.#writeLocalState(syncStatePath, {
          version: 1,
          bucket: this.#bucket,
          bucketToken: remoteControl.data.bucketToken,
          head: remoteHead,
          etag: remoteControl.etag,
          syncedChangeSeq: localState.syncedChangeSeq,
          pendingHead: null,
          pendingSeq: null,
          updatedAt: nowIso,
        });
      }
      this.#status = {
        mode: 'r2',
        status: 'in_sync',
        bucket: this.#bucket,
        head: remoteHead,
        offline: false,
        warning: null,
        conflictBackupPath: null,
      };
      return this.getStatus();
    }

    const snapshotObject = await this.#transport.getObject(`${this.#prefix}/snapshots/${remoteHead}.sqlite`, {
      timeoutMs: this.#pullTimeoutMs,
      signal,
    });
    if (!snapshotObject.exists || snapshotObject.body === null) {
      throw this.#domainError(`Remote control head snapshot missing from R2: ${remoteHead}.sqlite`);
    }
    if (snapshotObject.body.length < SQLITE_HEADER_MAGIC.length
      || !snapshotObject.body.subarray(0, SQLITE_HEADER_MAGIC.length).equals(SQLITE_HEADER_MAGIC)) {
      throw this.#domainError(`Downloaded snapshot ${remoteHead}.sqlite is not a valid SQLite database file.`);
    }

    const dbDir = path.dirname(dbPath);
    fs.mkdirSync(dbDir, { recursive: true });
    const tempSnapshotPath = path.join(dbDir, `.worlds-pull-${this.#uuidGenerator()}.sqlite.tmp`);
    let pulledChangeSeq = 0;
    let conflictBackupPath = null;

    try {
      fs.writeFileSync(tempSnapshotPath, snapshotObject.body);
      const stagedStore = this.#storeFactory(tempSnapshotPath);
      try {
        pulledChangeSeq = stagedStore.getLocalChangeSeq();
      } finally {
        stagedStore.close();
      }
      this.#removeSqliteSidecars(tempSnapshotPath);

      if (localDbExists) {
        const existingStore = this.#storeFactory(dbPath);
        let localChangeSeq = 0;
        let hasUnsyncedLocal = localState === null;
        try {
          localChangeSeq = existingStore.getLocalChangeSeq();
          if (localState !== null && localChangeSeq > localState.syncedChangeSeq) {
            hasUnsyncedLocal = true;
          }
          if (hasUnsyncedLocal) {
            const utcFolderName = new Date(this.#clock()).toISOString().replace(/[:.]/g, '-');
            let conflictDir = path.join(conflictsDir, utcFolderName);
            if (fs.existsSync(conflictDir)) {
              conflictDir = path.join(conflictsDir, `${utcFolderName}-${this.#uuidGenerator().slice(0, 8)}`);
            }
            fs.mkdirSync(conflictDir, { recursive: true });
            const candidateBackupPath = path.join(conflictDir, 'worlds.sqlite');
            existingStore.vacuumInto(candidateBackupPath);
            conflictBackupPath = candidateBackupPath;
          }
        } finally {
          existingStore.close();
        }
        this.#removeSqliteSidecars(dbPath);
      }

      fs.renameSync(tempSnapshotPath, dbPath);
      this.#removeSqliteSidecars(dbPath);
    } catch (error) {
      fs.rmSync(tempSnapshotPath, { force: true });
      this.#removeSqliteSidecars(tempSnapshotPath);
      throw error;
    }

    const nowIso = new Date(this.#clock()).toISOString();
    this.#writeLocalState(syncStatePath, {
      version: 1,
      bucket: this.#bucket,
      bucketToken: remoteControl.data.bucketToken,
      head: remoteHead,
      etag: remoteControl.etag,
      syncedChangeSeq: pulledChangeSeq,
      pendingHead: null,
      pendingSeq: null,
      updatedAt: nowIso,
    });
    this.#status = {
      mode: 'r2',
      status: conflictBackupPath !== null ? 'conflict_backed_up' : 'pulled',
      bucket: this.#bucket,
      head: remoteHead,
      offline: false,
      warning: conflictBackupPath !== null
        ? `Local unpushed changes backed up to ${conflictBackupPath} before pulling remote snapshot.`
        : null,
      conflictBackupPath,
    };
    return this.getStatus();
  }

  /**
   * @param {{store: object, syncStatePath: string, signal?: AbortSignal}} options
   * @returns {Promise<{status: string, saved: boolean, head: ?string, prunedCount?: number, message: string}>}
   * @throws {Error}
   */
  async pushSnapshot({ store, syncStatePath, signal } = {}) {
    if (store === null || typeof store !== 'object' || typeof store.vacuumInto !== 'function' || typeof store.getLocalChangeSeq !== 'function') {
      throw new Error('pushSnapshot requires a store with vacuumInto and getLocalChangeSeq.');
    }
    if (typeof syncStatePath !== 'string' || syncStatePath.trim().length === 0) {
      throw new Error('pushSnapshot requires a non-empty syncStatePath.');
    }
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
    }

    const queuedWork = this.#pushQueue.then(async () => {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError');
      }

      const hasForeign = await this.#transport.hasForeignObjects({
        allowedPrefix: this.#allowedRootFolder,
        timeoutMs: this.#pullTimeoutMs,
        signal,
      });
      if (hasForeign) {
        throw this.#domainError('Refusing sync: R2 bucket contains non-Worlds objects outside _worlds/.');
      }

      let localState = this.#readLocalState(syncStatePath);
      const remoteControl = await this.#readRemoteControl(signal);
      this.#assertSameBucketAndLineage(localState, remoteControl);

      if (localState !== null && localState.pendingHead !== null && remoteControl.exists && remoteControl.data.head === localState.pendingHead) {
        localState = {
          ...localState,
          head: remoteControl.data.head,
          etag: remoteControl.etag,
          syncedChangeSeq: localState.pendingSeq !== null ? localState.pendingSeq : localState.syncedChangeSeq,
          pendingHead: null,
          pendingSeq: null,
        };
      }

      if (remoteControl.exists) {
        if (localState === null && remoteControl.data.head !== null) {
          this.#status = {
            ...this.#status,
            status: 'conflict',
            head: remoteControl.data.head,
            warning: 'Remote bucket already holds an unpulled snapshot.',
          };
          return {
            status: 'conflict',
            saved: false,
            head: remoteControl.data.head,
            message: 'Remote bucket already holds a snapshot that has not been pulled locally.',
          };
        }
        if (localState !== null && remoteControl.data.head !== localState.head) {
          this.#status = {
            ...this.#status,
            status: 'conflict',
            head: remoteControl.data.head,
            warning: 'Remote snapshot advanced while local state points to an older head.',
          };
          return {
            status: 'conflict',
            saved: false,
            head: remoteControl.data.head,
            message: 'Remote snapshot has changed since the last sync; restart to pull and resolve conflict.',
          };
        }
      }

      const localChangeSeq = store.getLocalChangeSeq();
      const newHead = this.#uuidGenerator();
      const bucketToken = remoteControl.data?.bucketToken ?? localState?.bucketToken ?? this.#uuidGenerator();
      const snapshotKey = `${this.#prefix}/snapshots/${newHead}.sqlite`;
      const stateDir = path.dirname(syncStatePath);
      fs.mkdirSync(stateDir, { recursive: true });
      const tempSnapshotPath = path.join(stateDir, `.worlds-push-${this.#uuidGenerator()}.sqlite.tmp`);

      let snapshotBytes;
      try {
        store.vacuumInto(tempSnapshotPath);
        snapshotBytes = await fs.promises.readFile(tempSnapshotPath);
      } finally {
        fs.rmSync(tempSnapshotPath, { force: true });
        this.#removeSqliteSidecars(tempSnapshotPath);
      }

      const pendingIso = new Date(this.#clock()).toISOString();
      this.#writeLocalState(syncStatePath, {
        version: 1,
        bucket: this.#bucket,
        bucketToken,
        head: localState?.head ?? null,
        etag: remoteControl.etag ?? localState?.etag ?? null,
        syncedChangeSeq: localState?.syncedChangeSeq ?? 0,
        pendingHead: newHead,
        pendingSeq: localChangeSeq,
        updatedAt: pendingIso,
      });

      const snapshotPut = await this.#transport.putObject(snapshotKey, snapshotBytes, {
        contentType: 'application/x-sqlite3',
        ifNoneMatch: '*',
        signal,
      });
      if (snapshotPut.preconditionFailed) {
        this.#writeLocalState(syncStatePath, {
          version: 1,
          bucket: this.#bucket,
          bucketToken,
          head: localState?.head ?? null,
          etag: remoteControl.etag ?? localState?.etag ?? null,
          syncedChangeSeq: localState?.syncedChangeSeq ?? 0,
          pendingHead: null,
          pendingSeq: null,
          updatedAt: pendingIso,
        });
        throw this.#domainError(`Snapshot key collision for ${newHead}.sqlite.`);
      }

      const commitIso = new Date(this.#clock()).toISOString();
      const controlPayload = JSON.stringify({
        version: 1,
        bucketToken,
        change: this.#uuidGenerator(),
        head: newHead,
        updatedAt: commitIso,
        localSeq: localChangeSeq,
      });
      const controlPut = await this.#transport.putObject(`${this.#prefix}/control.json`, controlPayload, {
        contentType: 'application/json',
        ifMatch: remoteControl.exists ? remoteControl.etag : undefined,
        ifNoneMatch: remoteControl.exists ? undefined : '*',
        timeoutMs: this.#pullTimeoutMs,
        signal,
      });

      if (controlPut.preconditionFailed) {
        this.#writeLocalState(syncStatePath, {
          version: 1,
          bucket: this.#bucket,
          bucketToken,
          head: localState?.head ?? null,
          etag: remoteControl.etag ?? localState?.etag ?? null,
          syncedChangeSeq: localState?.syncedChangeSeq ?? 0,
          pendingHead: null,
          pendingSeq: null,
          updatedAt: commitIso,
        });
        try {
          await this.#transport.deleteObject(snapshotKey, { signal });
        } catch {
        }
        this.#status = {
          ...this.#status,
          status: 'conflict',
          warning: 'Concurrent update conflict detected while committing control.json.',
        };
        return {
          status: 'conflict',
          saved: false,
          head: remoteControl.data?.head ?? null,
          message: 'Concurrent update conflict on R2 control.json (HTTP 412).',
        };
      }

      const finalEtag = controlPut.etag !== null && STRONG_ETAG_REGEX.test(controlPut.etag)
        ? controlPut.etag
        : null;
      this.#writeLocalState(syncStatePath, {
        version: 1,
        bucket: this.#bucket,
        bucketToken,
        head: newHead,
        etag: finalEtag,
        syncedChangeSeq: localChangeSeq,
        pendingHead: null,
        pendingSeq: null,
        updatedAt: commitIso,
      });

      let prunedCount = 0;
      let pruneWarning = null;
      try {
        const snapshotPrefix = `${this.#prefix}/snapshots/`;
        const allSnapshots = await this.#transport.listObjects({
          prefix: snapshotPrefix,
          signal,
        });
        const headKey = snapshotKey;
        const referenceNowMs = controlPut.date ?? remoteControl.serverNowMs ?? this.#clock();
        const ordered = [...allSnapshots]
          .filter((entry) => entry.key.endsWith('.sqlite'))
          .sort((first, second) => {
            if (second.lastModified !== first.lastModified) {
              return second.lastModified - first.lastModified;
            }
            return second.key.localeCompare(first.key);
          });
        const candidates = ordered.slice(this.#maxSnapshots).filter(
          (entry) => entry.key !== headKey && referenceNowMs - entry.lastModified > this.#maxAgeMs,
        );
        for (const candidate of candidates) {
          await this.#transport.deleteObject(candidate.key, { signal });
          prunedCount += 1;
        }
      } catch (pruneError) {
        if (signal?.aborted) {
          throw pruneError;
        }
        pruneWarning = `Snapshot saved, but old snapshot pruning failed: ${pruneError.message}`;
      }

      this.#status = {
        mode: 'r2',
        status: 'ready',
        bucket: this.#bucket,
        head: newHead,
        offline: false,
        warning: pruneWarning,
        conflictBackupPath: null,
      };
      return {
        status: 'saved',
        saved: true,
        head: newHead,
        prunedCount,
        message: pruneWarning ?? `Saved snapshot ${newHead} to R2.`,
      };
    });

    this.#pushQueue = queuedWork.catch(() => {});
    return queuedWork;
  }

  /**
   * @param {string} message
   * @returns {Error}
   */
  #domainError(message) {
    const error = new Error(message);
    error.isSyncDomainError = true;
    return error;
  }

  /**
   * @param {string} syncStatePath
   * @returns {?{version: number, bucket: string, bucketToken: ?string, head: ?string, etag: ?string, syncedChangeSeq: number, pendingHead: ?string, pendingSeq: ?number, updatedAt: string}}
   * @throws {Error}
   */
  #readLocalState(syncStatePath) {
    let rawText;
    try {
      rawText = fs.readFileSync(syncStatePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      throw this.#domainError(`Corrupt local sync state at ${syncStatePath}: ${error.message}`);
    }
    if (
      parsed === null
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || parsed.version !== 1
      || (parsed.bucket !== undefined && (typeof parsed.bucket !== 'string' || !BUCKET_NAME_REGEX.test(parsed.bucket)))
      || (parsed.bucketToken !== null && parsed.bucketToken !== undefined && (typeof parsed.bucketToken !== 'string' || parsed.bucketToken.trim().length === 0))
      || (parsed.head !== null && (typeof parsed.head !== 'string' || !UUID_REGEX.test(parsed.head)))
      || (parsed.pendingHead !== null && parsed.pendingHead !== undefined && (typeof parsed.pendingHead !== 'string' || !UUID_REGEX.test(parsed.pendingHead)))
      || !Number.isSafeInteger(parsed.syncedChangeSeq)
      || parsed.syncedChangeSeq < 0
      || (parsed.pendingSeq !== null && parsed.pendingSeq !== undefined && (!Number.isSafeInteger(parsed.pendingSeq) || parsed.pendingSeq < 0))
    ) {
      throw this.#domainError(`Invalid local sync state schema at ${syncStatePath}.`);
    }
    return {
      version: 1,
      bucket: parsed.bucket,
      bucketToken: parsed.bucketToken ?? null,
      head: parsed.head,
      etag: typeof parsed.etag === 'string' ? parsed.etag : null,
      syncedChangeSeq: parsed.syncedChangeSeq,
      pendingHead: parsed.pendingHead ?? null,
      pendingSeq: parsed.pendingSeq ?? null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  }

  /**
   * @param {string} syncStatePath
   * @param {object} state
   * @returns {void}
   */
  #writeLocalState(syncStatePath, state) {
    const directory = path.dirname(syncStatePath);
    fs.mkdirSync(directory, { recursive: true });
    const tempPath = `${syncStatePath}.tmp-${this.#uuidGenerator()}`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
      fs.renameSync(tempPath, syncStatePath);
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  /**
   * @param {AbortSignal | undefined} signal
   * @returns {Promise<{exists: boolean, data: ?{version: number, bucketToken: string, change: string, head: ?string}, etag: ?string, serverNowMs: number}>}
   * @throws {Error}
   */
  async #readRemoteControl(signal) {
    const response = await this.#transport.getObject(`${this.#prefix}/control.json`, {
      timeoutMs: this.#pullTimeoutMs,
      signal,
    });
    const serverNowMs = response.date ?? this.#clock();
    if (!response.exists) {
      return {
        exists: false,
        data: null,
        etag: null,
        serverNowMs,
      };
    }
    if (response.etag === null || !STRONG_ETAG_REGEX.test(response.etag)) {
      throw this.#domainError('R2 control.json requires a strong ETag validator.');
    }
    let parsed;
    try {
      parsed = JSON.parse(response.body.toString('utf8'));
    } catch (error) {
      throw this.#domainError(`R2 control.json contains invalid JSON: ${error.message}`);
    }
    if (
      parsed === null
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || parsed.version !== 1
      || typeof parsed.bucketToken !== 'string'
      || parsed.bucketToken.trim().length === 0
      || typeof parsed.change !== 'string'
      || !UUID_REGEX.test(parsed.change)
      || (parsed.head !== null && (typeof parsed.head !== 'string' || !UUID_REGEX.test(parsed.head)))
    ) {
      throw this.#domainError('Invalid R2 control.json payload schema.');
    }
    return {
      exists: true,
      data: parsed,
      etag: response.etag,
      serverNowMs,
    };
  }

  /**
   * @param {?{bucket?: string, bucketToken: ?string, head: ?string}} localState
   * @param {{exists: boolean, data: ?{bucketToken: string, head: ?string}}} remoteControl
   * @returns {void}
   * @throws {Error}
   */
  #assertSameBucketAndLineage(localState, remoteControl) {
    if (localState === null) {
      return;
    }
    if (localState.bucket !== undefined && localState.bucket !== this.#bucket) {
      throw this.#domainError(
        `R2 bucket swap detected: local sync state belongs to "${localState.bucket}", configured bucket is "${this.#bucket}".`,
      );
    }
    if (!remoteControl.exists) {
      if (localState.bucketToken !== null || localState.head !== null) {
        throw this.#domainError(
          'R2 bucket swap or wipe detected: remote control.json is missing while local sync state expects an initialized bucket.',
        );
      }
      return;
    }
    if (localState.bucketToken !== null && remoteControl.data.bucketToken !== localState.bucketToken) {
      throw this.#domainError(
        `R2 bucket swap detected: remote bucketToken "${remoteControl.data.bucketToken}" does not match local "${localState.bucketToken}".`,
      );
    }
    if (localState.head !== null && remoteControl.data.head === null) {
      throw this.#domainError(
        `R2 head mismatch detected: local expects snapshot "${localState.head}", remote control head is null.`,
      );
    }
  }

  /**
   * @param {string} sqlitePath
   * @returns {void}
   */
  #removeSqliteSidecars(sqlitePath) {
    fs.rmSync(`${sqlitePath}-wal`, { force: true });
    fs.rmSync(`${sqlitePath}-shm`, { force: true });
  }
}
