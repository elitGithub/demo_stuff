import fs from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startChild } from './child.mjs';
import { createTransport, credentialNames, readCredentials } from './r2.mjs';
import { CloudStore } from './sync/CloudStore.mjs';
import { FileErrors } from './sync/FileErrors.mjs';
import { ProfileSync } from './sync/ProfileSync.mjs';
import { Retry } from './sync/Retry.mjs';
import { SaveOutcome } from './sync/SaveOutcome.mjs';
import { SaveReason } from './sync/SaveReason.mjs';
import { SyncPhase } from './sync/SyncPhase.mjs';
import { SyncSettings } from './sync/SyncSettings.mjs';

const project = dirname(import.meta.dirname);
const runtimeRoot = import.meta.dirname === join(project, 'src') ? project : import.meta.dirname;
const localOnly = 'Cloud save is not configured.';
const unreachable = 'Cloud unreachable: not pulled.';
const keptLocally = 'The changes stay on this PC. They go up the next time Universe starts here, unless the other PC saves first; ' +
  'then files changed on both PCs go to local/conflicts.';
const announcedPhases = Object.freeze([SyncPhase.Offline, SyncPhase.Conflict, SyncPhase.Disabled]);
const savedOutcomes = Object.freeze([SaveOutcome.Saved, SaveOutcome.Unchanged]);
const systemClock = Object.freeze({
  now: Date.now,

  /**
   * @param {number} milliseconds
   * @param {AbortSignal} [signal]
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async sleep(milliseconds, signal) {
    try {
      await delay(milliseconds, undefined, { signal });
    } catch (error) {
      if (!signal?.aborted) {
        throw error;
      }
    }
  },
});

/**
 * @param {string} text
 * @returns {void}
 */
function say(text) {
  console.log(`[universe] ${text}`);
}

/**
 * @param {string} contents
 * @param {NodeJS.ProcessEnv} system
 * @returns {object}
 * @throws {Error}
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
  return config;
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {object}
 * @throws {Error}
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
 * @param {{startChild?: Function, transport?: Function, clock?: {now: Function, sleep: Function}, onSaveReady?: Function}} [dependencies]
 * @returns {Promise<void>}
 * @throws {Error}
 */
export async function runLauncher(config, signal, onState, dependencies = {}) {
  const clock = dependencies.clock ?? systemClock;
  let latest = { phase: SyncPhase.Pulling, progress: null, lastSavedAt: null, unsavedSince: null, error: null, conflictAt: null,
    conflictsFolder: null, reloadTabs: false };
  let transfer = null;
  let stopping = false;
  /**
   * @param {object} changes
   * @returns {void}
   */
  const report = (changes) => {
    const next = { ...latest, ...changes };
    if (stopping && next.phase !== SyncPhase.Stopped) {
      next.phase = SyncPhase.Stopping;
    }
    if (next.phase !== latest.phase && announcedPhases.includes(next.phase)) {
      say(next.error);
    }
    if (next.progress !== null && transfer === null) {
      transfer = new AbortController();
      /**
       * @param {AbortSignal} watching
       * @returns {Promise<void>}
       */
      (async (watching) => {
        await clock.sleep(SyncSettings.ConsoleProgressMs, watching);
        while (!watching.aborted) {
          const { filesDone, filesTotal, bytesDone, bytesTotal } = latest.progress;
          say(`${latest.phase === SyncPhase.Pulling ? 'Pulling' : 'Saving'}: ${filesDone} of ${filesTotal} files, ` +
            `${(bytesDone / 1_000_000).toFixed(1)} of ${(bytesTotal / 1_000_000).toFixed(1)} MB.`);
          await clock.sleep(SyncSettings.ConsoleProgressMs, watching);
        }
      })(transfer.signal);
    } else if (next.progress === null && transfer !== null) {
      transfer.abort();
      transfer = null;
    }
    latest = next;
    onState(next);
  };
  report({});
  if (!(await FileErrors.missing(fs.stat(join(config.sillyTavern, 'server.js'))))?.isFile()) {
    throw new Error('SillyTavern is missing. Run npm ci and npm run build in the Universe directory.');
  }
  const cloud = config.credentials === null ? null : new CloudStore(dependencies.transport ?? createTransport(config.credentials));
  const sync = cloud === null ? null : new ProfileSync({ dataRoot: config.dataRoot, stateRoot: config.stateRoot,
    bucket: `${config.credentials.account}/${config.credentials.bucket}`, cloud, clock, onStatus: report });
  let started = { offline: false, disabled: localOnly };
  if (sync === null) {
    report({ phase: SyncPhase.Disabled, error: localOnly });
  } else {
    try {
      started = await sync.start({ signal });
    } catch (error) {
      if (!signal.aborted) {
        throw error;
      }
      say(error.message);
      return;
    }
  }
  if (latest.reloadTabs) {
    say('Pulled newer files from the cloud. Reload any open SillyTavern tabs.');
  }
  if (signal.aborted) {
    report({ phase: SyncPhase.Stopped });
    return;
  }
  const child = (dependencies.startChild ?? startChild)(config);
  const running = new AbortController();
  const background = [];
  if (started.disabled === null) {
    background.push(
      /**
       * @returns {Promise<void>}
       */
      (async () => {
        if (!started.offline) {
          await sync.save(SaveReason.Start);
          return;
        }
        try {
          await Retry.run((attempt) => cloud.readControl(attempt), {
            giveUpMs: Number.MAX_SAFE_INTEGER, clock, signal: running.signal,
            onWait: ({ error, nextMs }) => report({ error: `${unreachable} ${error.message} Retrying in ${Math.ceil(nextMs / 1000)} s.` }),
          });
        } catch (error) {
          if (!running.signal.aborted) {
            report({ error: error.message });
            say(error.message);
          }
          return;
        }
        if (!running.signal.aborted) {
          await sync.save(SaveReason.Reconnect);
        }
      })(),
      /**
       * @returns {Promise<void>}
       */
      (async () => {
        await clock.sleep(SyncSettings.SaveIntervalMs, running.signal);
        while (!running.signal.aborted) {
          await sync.save(SaveReason.Timer);
          await clock.sleep(SyncSettings.SaveIntervalMs, running.signal);
        }
      })(),
    );
    dependencies.onSaveReady?.(() => sync.save(SaveReason.Manual));
  }
  await Promise.race([child.finished, new Promise((stopRequested) => signal.addEventListener('abort', stopRequested, { once: true }))]);
  stopping = true;
  running.abort();
  dependencies.onSaveReady?.(null);
  const budget = new AbortController();
  clock.sleep(SyncSettings.StopBudgetMs, budget.signal).then(() => budget.abort());
  report({ phase: SyncPhase.Stopping });
  const ended = await child.stop();
  if (started.disabled === null) {
    await clock.sleep(SyncSettings.QuietMs, budget.signal);
    const result = await sync.save(SaveReason.Stop, { signal: budget.signal });
    if (savedOutcomes.includes(result.outcome)) {
      say(`Saved to cloud at ${result.at}.`);
    } else if (result.outcome === SaveOutcome.Failed) {
      say(`NOT SAVED TO CLOUD: ${result.error.replace(/\.$/, '')}. ${keptLocally}`);
    } else {
      say(`NOT SAVED TO CLOUD: ${result.error}`);
    }
  } else if (sync !== null) {
    say(`NOT SAVED TO CLOUD: ${started.disabled}`);
  }
  budget.abort();
  await Promise.all(background);
  report({ phase: SyncPhase.Stopped });
  if (ended.launchError !== null) {
    throw ended.launchError;
  }
}
