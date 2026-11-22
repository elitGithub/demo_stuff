import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { startChild } from './child.mjs';
import { captureCheckpoint, clearObsoleteCheckpoints, publishCheckpoint, sameFiles } from './checkpoint-store.mjs';
import { CloudSave, heartbeatMs, isId } from './classes/cloud-save.mjs';
import { claimLocal, readJournal, verifyStoryRoot, writeJournal } from './local-session.mjs';
import { createTransport, credentialNames, readCredentials } from './r2.mjs';
import { atomicFile, checkDirectory, inspect, readRegular, restore, snapshot } from './story-files.mjs';

const project = dirname(import.meta.dirname);
const runtimeRoot = import.meta.dirname === join(project, 'src') ? project : import.meta.dirname;

/**
 * @param {string} contents
 * @param {NodeJS.ProcessEnv} system
 * @returns {object}
 */
export function projectConfiguration(contents, system) {
  const settings = Object.create(null);
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    const entry = /^([A-Z_0-9]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'#]*))\s*(?:#.*)?$/.exec(line.trim());
    if (!entry || ![...credentialNames, 'UNIVERSE_PORT'].includes(entry[1]) || Object.hasOwn(settings, entry[1])) {
      throw new Error(`Invalid or duplicate setting in project .env on line ${index + 1}. See .env.example.`);
    }
    settings[entry[1]] = entry[2] ?? entry[3] ?? entry[4];
  }
  if (credentialNames.every((name) => !settings[name])) {
    for (const name of credentialNames) {
      delete settings[name];
    }
  }
  const config = configuration(settings);
  const local = join(project, 'local');
  config.configPath = join(local, 'config.yaml');
  config.env = {
    ...Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TERM'].filter((name) => system[name] !== undefined)
      .map((name) => [name, system[name]])),
    HOME: local,
    TMPDIR: local,
    SILLYTAVERN_LISTEN: 'false',
    SILLYTAVERN_PORT: '8000',
  };
  if (config.port === 8000) {
    throw new Error('UNIVERSE_PORT must differ from the SillyTavern port (8000).');
  }
  config.projectLocal = true;
  return config;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {object}
 */
export function configuration(env) {
  if ([env.ST_DIR, env.ST_DATA_ROOT].some((value) => value !== undefined && value.trim() === '')) {
    throw new Error('Configured story and SillyTavern directories cannot be empty.');
  }
  const dataRoot = resolve(env.ST_DATA_ROOT ?? join(project, 'local', 'data'));
  const sillyTavern = resolve(env.ST_DIR ?? join(runtimeRoot, 'node_modules', 'sillytavern'));
  const stateRoot = `${dataRoot}.universe`;
  const port = Number(env.UNIVERSE_PORT ?? '8767');
  const roots = [dataRoot, stateRoot, sillyTavern];
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('UNIVERSE_PORT must be an integer from 1 to 65535.');
  }
  for (const root of roots) {
    if (root === dirname(root) || roots.filter((other) => {
      const path = relative(root, other);
      return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
    }).length > 1) {
      throw new Error('Use distinct SillyTavern, data and Universe sidecar directories.');
    }
  }
  return { env, dataRoot, sillyTavern, stateRoot, port, credentials: readCredentials(env) };
}

/**
 * @param {object} config
 * @param {AbortSignal} signal
 * @param {Function} onState
 * @param {object} [dependencies]
 * @returns {Promise<void>}
 */
export async function runLauncher(config, signal, onState, dependencies = {}) {
  const childFactory = dependencies.startChild ?? startChild;
  const cloud = config.credentials ? new CloudSave(dependencies.transport ?? createTransport(config.credentials)) : null;
  const bucket = config.credentials ? `${config.credentials.account}/${config.credentials.bucket}` : null;
  const journalPath = join(config.stateRoot, 'journal.json');
  const identityPath = join(config.dataRoot, '.universe-story-root');
  let rootId;
  let localOwner;
  let child;
  let heartbeat;
  let heartbeatWork = Promise.resolve();
  let heartbeatError;
  const clock = dependencies.clock ?? globalThis;
  let checkpointTimer;
  let checkpointWork;
  let activeBatch;
  let nextBatch;
  let confirmedAt = null;
  let running = false;
  let retryOnIdle = false;
  let unsubscribe;
  let cloudAttempted = false;
  let cloudReleased = false;
  let failure;

  const update = (phase, extra = {}) => onState({ phase, ...extra });
  const verifyRoot = () => verifyStoryRoot(config.dataRoot, rootId);
  const saveJournal = (phase, details) => writeJournal(config, { version: 3, bucket, phase, rootId, ...details });
  const stopHeartbeat = async () => {
    clock.clearInterval(heartbeat);
    await heartbeatWork;
  };
  const stopped = new Promise((resolveStop) => {
    if (signal.aborted) {
      resolveStop(null);
    } else {
      signal.addEventListener('abort', () => resolveStop(null), { once: true });
    }
  });
  let stopForLease;
  const leaseFailed = new Promise((resolveFailure) => { stopForLease = resolveFailure; });

  const beforeCommit = async (finish) => {
    if (finish) {
      await stopHeartbeat();
    }
    if (heartbeatError) {
      throw heartbeatError;
    }
  };
  const checkpoint = async (liveChild, batch) => {
    let journal = await readJournal(config.stateRoot);
    const roots = { dataRoot: config.dataRoot, stateRoot: config.stateRoot, rootId };
    let published = false;
    const publish = async (capture, finish) => {
      ({ journal } = await publishCheckpoint({ cloud, capture, finish, beforeCommit: () => beforeCommit(finish) }));
      published = true;
      confirmedAt = new Date().toISOString();
      onState({ lastSyncAt: confirmedAt, revision: journal.base });
    };
    if (journal.phase === 'publishing') {
      await publish({ ...roots, id: journal.manifest.id }, false);
    }
    const capture = () => {
      if (batch) {
        batch.capturing = true;
      }
      return captureCheckpoint({ ...roots, base: journal.base, confirmedFiles: journal.files });
    };
    let result;
    if (liveChild) {
      const barrier = await liveChild.withCaptureBarrier(randomUUID(), capture);
      if (barrier.state !== 'captured') {
        onState({ checkpoint: barrier.state, pending: true });
        return { checkpoint: barrier.state };
      }
      retryOnIdle = false;
      result = barrier.value;
    } else {
      result = await capture();
    }
    if (!result.unchanged) {
      await publish(result, !liveChild);
    } else if (!liveChild) {
      await beforeCommit(true);
      await cloud.release();
      await saveJournal('clean', { base: journal.base, files: journal.files, format: journal.format });
    }
    const outcome = { checkpoint: published ? 'saved' : 'unchanged', lastSyncAt: confirmedAt };
    onState({ ...outcome, pending: false, checkpointError: null });
    return outcome;
  };
  const requestCheckpoint = () => {
    if (!running || signal.aborted || heartbeatError) {
      return Promise.resolve({ checkpoint: 'unavailable' });
    }
    if (activeBatch) {
      if (!activeBatch.capturing) {
        return activeBatch.promise;
      }
      nextBatch ??= Promise.withResolvers();
      return nextBatch.promise;
    }
    activeBatch = Promise.withResolvers();
    const requested = activeBatch.promise;
    checkpointWork = (async () => {
      while (activeBatch) {
        retryOnIdle = true;
        onState({ checkpoint: 'checking', pending: true });
        try {
          activeBatch.resolve(await checkpoint(child, activeBatch));
        } catch (error) {
          retryOnIdle = false;
          onState({ checkpoint: 'failed', pending: true, checkpointError: error.message });
          activeBatch.resolve({ checkpoint: 'failed' });
        }
        activeBatch = nextBatch;
        nextBatch = undefined;
      }
    })();
    return requested;
  };
  const stopCheckpoints = async () => {
    running = false;
    dependencies.onSaveReady?.(null);
    nextBatch?.resolve({ checkpoint: 'unavailable' });
    nextBatch = undefined;
    clock.clearInterval(checkpointTimer);
    unsubscribe?.();
    await checkpointWork;
  };

  try {
    for (const [variable, name] of [['ST_DIR', 'sillytavern'], ['ST_DATA_ROOT', 'runtime-data']]) {
      if (config.env[variable] === undefined && await inspect(join(project, name))) {
        throw new Error(config.projectLocal
          ? `A legacy ${name} path exists. Preserve it and follow the migration instructions in README.md.`
          : `A legacy ${name} path exists. Preserve it and explicitly set ${variable} to the intended path.`);
      }
    }
    const installed = await checkDirectory(config.sillyTavern);
    if (installed) {
      const entry = await inspect(join(config.sillyTavern, 'server.js'));
      if (!entry?.isFile()) {
        throw new Error('SillyTavern directory exists but server.js is missing or unsafe.');
      }
    } else if (config.projectLocal) {
      throw new Error('SillyTavern is missing. Run npm ci and npm run build in the Universe directory.');
    } else if (config.env.ST_DIR !== undefined) {
      throw new Error('Configured SillyTavern directory does not exist.');
    }
    if (!installed && !(await inspect(journalPath))) {
      update('standalone');
      await stopped;
      return;
    }

    localOwner = await claimLocal(config.stateRoot);
    if (config.configPath && await readRegular(config.configPath) === null) {
      const legacyConfig = await readRegular(join(dirname(config.configPath), 'SillyTavern', 'config.yaml'));
      if (legacyConfig !== null) {
        await atomicFile(config.configPath, legacyConfig);
      }
    }
    let journal = await readJournal(config.stateRoot);
    if (journal !== null && journal.bucket !== bucket) {
      if (config.projectLocal && !cloud && journal.bucket !== null) {
        throw new Error('This story uses cloud handoff. Set its original four R2 values in the Universe .env.');
      }
      throw new Error('Existing Universe journal belongs to a different cloud configuration. Use the original bucket and preserve the journal.');
    }
    let head = null;
    if (cloud) {
      update('restoring', { pending: journal !== null && journal.phase !== 'clean' });
      if (journal) {
        rootId = journal.rootId;
        await verifyRoot();
      } else {
        await checkDirectory(config.dataRoot, installed);
        const existing = await readRegular(identityPath);
        if (existing !== null) {
          rootId = existing.toString();
          if (!isId(rootId)) {
            throw new Error('Invalid effective story directory identity file.');
          }
        } else {
          rootId = randomUUID();
          await atomicFile(identityPath, rootId);
        }
      }
      cloudAttempted = true;
      head = await cloud.acquire();
      heartbeat = clock.setInterval(() => {
        heartbeatWork = heartbeatWork.then(() => cloud.update('renew')).catch((error) => {
          heartbeatError = error;
          clock.clearInterval(heartbeat);
          stopForLease(null);
        });
        return heartbeatWork;
      }, heartbeatMs);
      if (journal?.version === 1 && journal.phase === 'editing') {
        throw new Error('Interrupted legacy editing session. Preserve the local story and reconcile manually.');
      }
      if (journal?.phase === 'publishing') {
        const capture = { dataRoot: config.dataRoot, stateRoot: config.stateRoot, rootId, id: journal.manifest.id };
        update('saving', { pending: true });
        ({ journal, head } = await publishCheckpoint({ cloud, capture, finish: false, beforeCommit: () => beforeCommit(false) }));
      }
      if (journal?.phase === 'restoring') {
        const target = await cloud.findAncestor(head, journal.target);
        if (!target) {
          throw new Error('Pending restore target is missing from cloud history. Preserve the local story and journal.');
        }
        await restore(config.dataRoot, journal.files, target.files, (hash) => cloud.download(hash), verifyRoot, target.version, journal.format ?? 1);
        journal = await saveJournal('clean', { base: target.id, files: target.files, format: target.version });
      }
      const remote = journal === null && head !== null ? await cloud.manifest(head) : null;
      const format = journal ? journal.format ?? 1 : remote?.version ?? 2;
      const files = await snapshot(config.dataRoot, format);
      if (journal === null) {
        if (remote && files.length > 0 && !sameFiles(files, remote.files)) {
          throw new Error('Existing local story differs from the cloud save. Preserve it and use an empty data directory to restore the cloud copy.');
        }
        const base = remote && sameFiles(files, remote.files) ? remote.id : null;
        journal = base === null && files.length ? { base, files, format } : await saveJournal('clean', { base, files, format });
      }
      if (journal.base !== null) {
        const ancestor = await cloud.findAncestor(head, journal.base);
        if (!ancestor || ancestor.version !== format || !sameFiles(journal.files, ancestor.files)) {
          throw new Error('Cloud history differs from the last known local revision. Preserve both copies before recovery.');
        }
      }
      const target = head !== null && head !== journal.base ? await cloud.manifest(head) : null;
      if (!sameFiles(files, journal.files) &&
          !(journal.phase === 'editing' && journal.base !== null && target &&
            sameFiles(format === target.version ? files : await snapshot(config.dataRoot, target.version), target.files))) {
        throw new Error('Local story differs from its last acknowledged state. Preserve the data and journal and reconcile manually.');
      }
      if (target) {
        if (journal.base === null && files.length > 0 && !sameFiles(files, target.files)) {
          throw new Error('Unpublished local story differs from the cloud save. Preserve both copies before recovery.');
        }
        if (format !== target.version || !sameFiles(files, target.files)) {
          await saveJournal('restoring', { base: journal.base, files, target: head, format });
          await restore(config.dataRoot, files, target.files, (hash) => cloud.download(hash), verifyRoot, target.version, format);
        }
        journal = await saveJournal('clean', { base: head, files: target.files, format: target.version });
      }
    }
    if (!cloud) {
      await checkDirectory(config.dataRoot, installed);
    }
    if (heartbeatError) {
      throw heartbeatError;
    }
    if (signal.aborted) {
      return;
    }
    if (!installed) {
      await stopHeartbeat();
      await cloud.release();
      cloudReleased = true;
      update('standalone');
      await stopped;
      return;
    }
    if (cloud) {
      journal = await saveJournal('editing', {
        base: journal.base, files: journal.base === null ? [] : journal.files, format: journal.format ?? 1, operation: randomUUID(),
      });
      await clearObsoleteCheckpoints(config.stateRoot);
    }
    if (signal.aborted || heartbeatError) {
      if (heartbeatError) {
        throw heartbeatError;
      }
      return;
    }
    child = childFactory(config, localOwner);
    await child.allowEdits();
    if (cloud) {
      running = true;
      unsubscribe = child.onCheckpointIdle?.(() => {
        if (retryOnIdle) {
          return requestCheckpoint();
        }
      });
      child.checkpointReady?.then(ready => {
        if (running && ready) {
          checkpointTimer = clock.setInterval(requestCheckpoint, 900_000);
          dependencies.onSaveReady?.(requestCheckpoint);
        } else if (running) {
          onState({ checkpoint: 'unavailable', pending: true });
        }
      });
    }
    update('running', { childPid: child.pid, pending: Boolean(cloud) });
    let outcome = await Promise.race([child.finished, stopped, leaseFailed]);
    await stopCheckpoints();
    if (outcome === null) {
      update('stopping');
      outcome = await child.stop();
    }
    child = null;
    update('stopped', { childPid: null });
    if (heartbeatError || outcome.forced || outcome.launchError || outcome.code !== 0 || outcome.signal) {
      throw heartbeatError ?? outcome.launchError ?? new Error('SillyTavern did not stop cleanly. Story changes remain local for recovery.');
    }
    if (cloud) {
      update('saving', { pending: true });
      await checkpoint(null);
      cloudReleased = true;
      update('saved', { pending: false });
    }
  } catch (error) {
    failure = error;
    update('failed', { childPid: null });
  } finally {
    const cleanup = [];
    await stopCheckpoints();
    if (child) {
      cleanup.push(await child.stop().then(() => null, (error) => error));
    }
    await stopHeartbeat();
    if (cloudAttempted && !cloudReleased) {
      cleanup.push(await cloud.release().then(() => null, (error) => error));
    }
    if (localOwner) {
      cleanup.push(await atomicFile(join(localOwner, 'released'), '').then(() => null, (error) => error));
    }
    const errors = [failure, ...cleanup].filter(Boolean);
    if (errors.length > 1) {
      throw new AggregateError(errors, errors.map((error) => error.message).join(' '));
    }
    if (errors.length === 1) {
      throw errors[0];
    }
  }
}
