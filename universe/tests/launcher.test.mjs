import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, cp, link, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setImmediate as nextTurn, setTimeout as pause } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { startChild } from '../src/child.mjs';
import { configuration, projectConfiguration, runLauncher } from '../src/launcher.mjs';
import { digest, readCredentials } from '../src/r2.mjs';
import { createWrapperHandler } from '../src/server.mjs';
import { ProfileSync } from '../src/sync/ProfileSync.mjs';
import { SyncPhase } from '../src/sync/SyncPhase.mjs';
import { SyncSettings } from '../src/sync/SyncSettings.mjs';
import { MemoryBucket } from './support/MemoryBucket.mjs';

const project = dirname(import.meta.dirname);

const credentials = {
  R2_ACCOUNT_ID: 'testaccount',
  R2_ACCESS_KEY_ID: 'testkey',
  R2_SECRET_ACCESS_KEY: 'synthetic-cloud-secret',
  R2_BUCKET: 'test-bucket',
};
const prefix = '_universe/v2';
const controlKey = `${prefix}/control.json`;
const story = 'default-user/chats/Ann/one.jsonl';
const starter = {
  'default-user/settings.json': '{"theme":"dark"}',
  [story]: '{"m":1}\n',
  'default-user/characters/Ann.png': 'png-bytes',
};
const keptLocally = 'The changes stay on this PC. They go up the next time Universe starts here, unless the other PC saves first; ' +
  'then files changed on both PCs go to local/conflicts.';
const parkedDurations = [SyncSettings.SaveIntervalMs, SyncSettings.StopBudgetMs, SyncSettings.ConsoleProgressMs];
const origin = 'http://127.0.0.1:8767';

/**
 * @returns {{time: number, hold: boolean, parked: object[], now: Function, sleep: Function, waiting: Function, fire: Function}}
 */
function testClock() {
  const clock = {
    time: Date.now() + 60_000,
    hold: false,
    parked: [],
    /**
     * @returns {number}
     */
    now() {
      return clock.time;
    },
    /**
     * @param {number} milliseconds
     * @param {AbortSignal} [signal]
     * @returns {Promise<void>}
     */
    sleep(milliseconds, signal) {
      if (!clock.hold && !parkedDurations.includes(milliseconds)) {
        clock.time += milliseconds;
        return new Promise((resolve) => setImmediate(resolve));
      }
      return new Promise((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        const entry = { milliseconds, wake: resolve };
        clock.parked.push(entry);
        signal?.addEventListener('abort', () => {
          clock.parked = clock.parked.filter((other) => other !== entry);
          resolve();
        }, { once: true });
      });
    },
    /**
     * @param {number} milliseconds
     * @returns {boolean}
     */
    waiting(milliseconds) {
      return clock.parked.some((entry) => entry.milliseconds === milliseconds);
    },
    /**
     * @param {number} milliseconds
     * @returns {void}
     */
    fire(milliseconds) {
      const due = clock.parked.filter((entry) => entry.milliseconds === milliseconds);
      assert.ok(due.length > 0, `nothing waits for ${milliseconds} ms`);
      clock.parked = clock.parked.filter((entry) => entry.milliseconds !== milliseconds);
      clock.time += milliseconds;
      for (const entry of due) {
        entry.wake();
      }
    },
  };
  return clock;
}

/**
 * @param {MemoryBucket} bucket
 * @returns {{down: boolean, before: ?Function, transport: Function}}
 */
function wire(bucket) {
  const line = {
    down: false,
    before: null,
    /**
     * @param {string} method
     * @param {string} key
     * @param {object} options
     * @returns {Promise<Response>}
     * @throws {Error}
     */
    async transport(method, key, options) {
      await line.before?.(method, key, options);
      if (line.down) {
        throw new TypeError('fetch failed', { cause: new Error('ENETUNREACH') });
      }
      return bucket.request(method, key, options);
    },
  };
  return line;
}

/**
 * @param {import('node:test').TestContext} context
 * @returns {Promise<string>}
 */
async function workspace(context) {
  const root = await mkdtemp(join(tmpdir(), 'universe-launcher-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * @param {string} root
 * @param {Record<string, string>} files
 * @returns {Promise<void>}
 */
async function put(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 * @throws {Error}
 */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
}

/**
 * @param {string} root
 * @param {string} name
 * @returns {Promise<object>}
 */
async function machine(root, name) {
  const application = join(root, name, 'SillyTavern');
  await put(application, { 'server.js': '' });
  return configuration({ ...credentials, ST_DIR: application, ST_DATA_ROOT: join(root, name, 'local', 'data') });
}

/**
 * @param {import('node:test').TestContext} context
 * @returns {string[]}
 */
function capture(context) {
  const lines = [];
  context.mock.method(console, 'log', (text) => {
    lines.push(text);
  });
  return lines;
}

/**
 * @param {Function} predicate
 * @param {string} what
 * @returns {Promise<void>}
 */
async function until(predicate, what) {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      assert.fail(`Timed out waiting for ${what}.`);
    }
    await pause(2);
  }
}

/**
 * @param {object} config
 * @param {Function} transport
 * @param {{clock?: object, lines?: string[], name?: string, onState?: Function}} [options]
 * @returns {object}
 */
function launch(config, transport, options = {}) {
  const clock = options.clock ?? testClock();
  const controller = new AbortController();
  const exit = Promise.withResolvers();
  const session = { clock, controller, states: [], latest: null, saveNow: null, starts: 0, stops: 0 };
  session.task = runLauncher(config, controller.signal, (state) => {
    session.states.push(state);
    session.latest = state;
    options.onState?.(state);
  }, {
    transport,
    clock,
    /**
     * @returns {{pid: number, finished: Promise<object>, stop: Function}}
     */
    startChild: () => {
      session.starts += 1;
      options.lines?.push(`[test] ${options.name ?? 'alpha'} child started`);
      return {
        pid: 4242,
        finished: exit.promise,
        /**
         * @returns {Promise<object>}
         */
        async stop() {
          session.stops += 1;
          exit.resolve({ code: null, signal: 'SIGTERM', launchError: null });
          return exit.promise;
        },
      };
    },
    /**
     * @param {?Function} handler
     * @returns {void}
     */
    onSaveReady: (handler) => {
      session.saveNow = handler;
    },
  });
  return session;
}

/**
 * @param {object} session
 * @returns {Promise<void>}
 */
function idle(session) {
  return until(() => session.starts === 1 && session.latest.phase === SyncPhase.Running, 'the start save');
}

/**
 * @param {Promise} task
 * @returns {{settled: boolean}}
 */
function watchSettled(task) {
  const watch = { settled: false };
  /**
   * @returns {void}
   */
  const mark = () => {
    watch.settled = true;
  };
  task.then(mark, mark);
  return watch;
}

/**
 * @param {AbortSignal} signal
 * @returns {Promise<never>}
 */
function hang(signal) {
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/**
 * @param {object} session
 * @returns {Promise<void>}
 */
async function stop(session) {
  session.controller.abort();
  await session.task;
}

/**
 * @param {MemoryBucket} bucket
 * @returns {{head: string, files: Record<string, string>}}
 */
function cloudFiles(bucket) {
  const head = JSON.parse(bucket.objects.get(controlKey).body).head;
  const manifest = JSON.parse(bucket.objects.get(`${prefix}/manifests/${head}.json`).body);
  return { head, files: Object.fromEntries(manifest.files.map((entry) => [entry.path, entry.hash])) };
}

/**
 * @param {Function} handler
 * @param {string} url
 * @param {string} method
 * @param {object} headers
 * @returns {Promise<{code: number, headers: object, body: ?string}>}
 */
async function wrapperRequest(handler, url, method = 'GET', headers = {}) {
  const result = {};
  await handler({ url, method, headers: { host: '127.0.0.1:8767', ...headers } }, {
    /**
     * @param {number} code
     * @param {object} values
     * @returns {object}
     */
    writeHead(code, values) {
      Object.assign(result, { code, headers: values });
      return this;
    },
    /**
     * @param {?string} body
     * @returns {void}
     */
    end(body) {
      result.body = body;
    },
  });
  return result;
}

/**
 * @param {Function} handler
 * @returns {Promise<string>}
 */
async function csrfToken(handler) {
  return /<meta name="universe-csrf" content="([^"]+)">/.exec((await wrapperRequest(handler, '/')).body)[1];
}

test('project configuration uses local paths and settings even when the shell has overrides', () => {
  const system = {
    PATH: 'test-path', ST_DIR: 'elsewhere', ST_DATA_ROOT: 'another-root', R2_BUCKET: 'other-bucket',
    UNIVERSE_PORT: '9000', NODE_OPTIONS: 'external', SILLYTAVERN_CONFIGPATH: 'elsewhere',
    SILLYTAVERN_PORT: '7000', SILLYTAVERN_BROWSERLAUNCH_ENABLED: 'false',
  };
  const contents = Object.entries(credentials).map(([name, value]) => `${name}="${value}"`).join('\r\n');
  const config = projectConfiguration(`${contents}\nUNIVERSE_PORT=9001`, system);
  const defaults = configuration({});
  assert.equal(config.port, 9001);
  assert.equal(config.sillyTavern, defaults.sillyTavern);
  assert.equal(config.sillyTavern, join(dirname(dirname(defaults.dataRoot)), 'node_modules', 'sillytavern'));
  assert.equal(config.configPath, join(dirname(defaults.dataRoot), 'config.yaml'));
  assert.equal(config.dataRoot, defaults.dataRoot);
  assert.equal(config.stateRoot, defaults.stateRoot);
  assert.deepEqual(config.credentials, readCredentials(credentials));
  assert.deepEqual(config.env, {
    PATH: 'test-path', HOME: dirname(defaults.dataRoot), TMPDIR: dirname(defaults.dataRoot),
    SILLYTAVERN_LISTEN: 'false', SILLYTAVERN_PORT: '8000',
  });
  assert.equal(projectConfiguration('', system).credentials, null);
  assert.equal(projectConfiguration('', system).port, 8767);
});

test('project configuration catches incomplete cloud credentials and invalid settings', () => {
  const empty = Object.keys(credentials).map((name) => `${name}=`).join('\n');
  assert.equal(projectConfiguration(empty, {}).credentials, null);
  assert.throws(() => projectConfiguration('R2_ACCESS_KEY_ID=abc', {}), /all four/);
  assert.throws(() => projectConfiguration('R2_ACCOUNT', {}), /line 1/);
  assert.throws(() => projectConfiguration('ST_DIR=elsewhere', {}), /line 1/);
  assert.throws(() => projectConfiguration('UNIVERSE_PORT=9000\nUNIVERSE_PORT=9999', {}), /line 2/);
  assert.throws(() => projectConfiguration('UNIVERSE_PORT=8000', {}), /SillyTavern port/);
});

test('a missing SillyTavern installation stops before any cloud request or local state', async (context) => {
  const root = await workspace(context);
  const alpha = await machine(root, 'alpha');
  await rm(join(alpha.sillyTavern, 'server.js'));
  await assert.rejects(runLauncher(alpha, new AbortController().signal, () => {}, {
    transport: () => assert.fail('cloud request before the installation check'),
    startChild: () => assert.fail('child started without an installation'),
  }), /SillyTavern is missing/);
  assert.equal(await exists(alpha.stateRoot), false);
});

test('a restart after a crash with rebuilt caches and unsaved chat edits starts SillyTavern and uploads the edits', async (context) => {
  const lines = capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const alpha = await machine(root, 'alpha');
  await put(alpha.dataRoot, { ...starter, '_cache/index.json': '{"v":1}', 'cookie-secret.txt': 'first' });
  const first = launch(alpha, bucket.transport);
  await idle(first);
  await stop(first);
  assert.match(lines.at(-1), /^\[universe\] Saved to cloud at /);
  const saved = cloudFiles(bucket);
  assert.equal(saved.files[story], digest(starter[story]));
  const edited = '{"m":1}\n{"m":2}\n';
  await put(alpha.dataRoot, {
    [story]: edited,
    '_cache/index.json': '{"v":2}',
    '_webpack/chunk.js': 'rebuilt',
    'cookie-secret.txt': 'second',
    'default-user/backups/settings_1.json': '{}',
  });
  const second = launch(alpha, bucket.transport);
  await idle(second);
  assert.equal(second.stops, 0);
  const uploaded = cloudFiles(bucket);
  assert.notEqual(uploaded.head, saved.head);
  assert.equal(uploaded.files[story], digest(edited));
  assert.deepEqual(Object.keys(uploaded.files).sort(), Object.keys(starter).sort());
  assert.ok(second.latest.lastSavedAt);
  assert.equal(await exists(join(dirname(alpha.dataRoot), 'conflicts')), false);
  await stop(second);
  assert.match(lines.at(-1), /^\[universe\] Saved to cloud at /);
});

test('twenty failed requests in the middle of a session never stop SillyTavern, and the save lands once requests succeed', async (context) => {
  const lines = capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const alpha = await machine(root, 'alpha');
  await put(alpha.dataRoot, starter);
  const session = launch(alpha, bucket.transport);
  await idle(session);
  const before = cloudFiles(bucket).head;
  const edited = '{"m":"written during the outage"}\n';
  await put(alpha.dataRoot, { [story]: edited });
  bucket.failNext(20);
  session.clock.fire(SyncSettings.SaveIntervalMs);
  await until(() => session.latest.phase === SyncPhase.Running && cloudFiles(bucket).head !== before, 'the timer save to land');
  assert.equal(bucket.failures, 0);
  assert.equal(cloudFiles(bucket).files[story], digest(edited));
  assert.equal(session.stops, 0);
  assert.ok(session.states.filter((state) => /^fetch failed Retrying in /.test(state.error ?? '')).length >= 20);
  assert.equal(session.latest.error, null);
  assert.ok(!lines.some((text) => text.includes('fetch failed')));
  await stop(session);
  assert.match(lines.at(-1), /^\[universe\] Saved to cloud at /);
});

for (const [label, retrying] of [['the final save', false], ['a timer save already retrying', true]]) {
  test(`a stop with the network down names the failure in the final line when ${label} runs out the budget, and the next start uploads`, async (context) => {
    const lines = capture(context);
    const root = await workspace(context);
    const bucket = new MemoryBucket();
    const line = wire(bucket);
    const alpha = await machine(root, 'alpha');
    await put(alpha.dataRoot, starter);
    const first = launch(alpha, line.transport);
    await idle(first);
    const saved = cloudFiles(bucket).head;
    const edited = '{"m":"unsaved at stop"}\n';
    await put(alpha.dataRoot, { [story]: edited });
    line.down = true;
    first.clock.hold = true;
    if (retrying) {
      first.clock.fire(SyncSettings.SaveIntervalMs);
      await until(() => first.clock.waiting(SyncSettings.RetryDelaysMs[0]), 'the timer save to wait for its first retry');
    }
    first.controller.abort();
    await until(() => first.clock.waiting(SyncSettings.QuietMs), 'the quiet wait after SillyTavern stopped');
    assert.equal(first.stops, 1);
    first.clock.fire(SyncSettings.QuietMs);
    if (!retrying) {
      await until(() => first.clock.waiting(SyncSettings.RetryDelaysMs[0]), 'the first retry of the final save');
    }
    first.clock.fire(SyncSettings.StopBudgetMs);
    await first.task;
    assert.equal(lines.at(-1), `[universe] NOT SAVED TO CLOUD: Stopped before the save finished: fetch failed. ${keptLocally}`);
    assert.equal(cloudFiles(bucket).head, saved);
    line.down = false;
    const second = launch(alpha, line.transport);
    await idle(second);
    assert.equal(cloudFiles(bucket).files[story], digest(edited));
    await stop(second);
  });
}

test('Ctrl+C during a running save stays inside the stop budget', async (context) => {
  const lines = capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const alpha = await machine(root, 'alpha');
  await put(alpha.dataRoot, starter);
  const session = launch(alpha, line.transport);
  await idle(session);
  const saved = cloudFiles(bucket).head;
  const stuck = '{"m":"stuck"}\n';
  await put(alpha.dataRoot, { [story]: stuck });
  let hung = null;
  /**
   * @param {string} method
   * @param {string} key
   * @param {object} options
   * @returns {?Promise<never>}
   */
  line.before = (method, key, options) => {
    if (method !== 'PUT' || key !== `${prefix}/blobs/${digest(stuck)}`) {
      return null;
    }
    hung = options.signal;
    return hang(options.signal);
  };
  session.clock.fire(SyncSettings.SaveIntervalMs);
  await until(() => hung !== null && session.clock.waiting(SyncSettings.ConsoleProgressMs), 'the stuck upload');
  session.clock.fire(SyncSettings.ConsoleProgressMs);
  await until(() => lines.includes('[universe] Saving: 0 of 1 files, 0.0 of 0.0 MB.'), 'the progress line');
  const stopping = watchSettled(session.task);
  session.controller.abort();
  await until(() => session.clock.waiting(SyncSettings.StopBudgetMs) && session.stops === 1, 'the stop budget');
  await pause(50);
  assert.equal(stopping.settled, false);
  assert.equal(hung.aborted, false);
  session.clock.fire(SyncSettings.StopBudgetMs);
  await session.task;
  assert.equal(hung.aborted, true);
  assert.equal(lines.at(-1), `[universe] NOT SAVED TO CLOUD: Stopped before the save finished. ${keptLocally}`);
  assert.equal(cloudFiles(bucket).head, saved);
  assert.equal(session.latest.phase, SyncPhase.Stopped);
  assert.deepEqual(session.clock.parked, []);
});

test('once a stop begins, the status says stopping until the final save ends, even when a running save finishes first', async (context) => {
  capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const alpha = await machine(root, 'alpha');
  await put(alpha.dataRoot, starter);
  const state = {};
  const session = launch(alpha, line.transport, { onState: (next) => Object.assign(state, next) });
  const handler = createWrapperHandler(state, 8767, () => null);
  await idle(session);
  const held = '{"m":"held"}\n';
  await put(alpha.dataRoot, { [story]: held });
  const release = Promise.withResolvers();
  let holding = false;
  /**
   * @param {string} method
   * @param {string} key
   * @returns {Promise<void>}
   */
  line.before = async (method, key) => {
    if (method === 'PUT' && key === `${prefix}/blobs/${digest(held)}`) {
      holding = true;
      await release.promise;
    }
  };
  session.clock.fire(SyncSettings.SaveIntervalMs);
  await until(() => holding, 'the held upload');
  session.clock.hold = true;
  session.controller.abort();
  await until(() => session.stops === 1, 'SillyTavern to stop');
  const marker = session.states.length;
  release.resolve();
  await until(() => session.latest.progress === null && cloudFiles(bucket).files[story] === digest(held), 'the timer save to land');
  assert.equal(JSON.parse((await wrapperRequest(handler, '/status')).body).phase, SyncPhase.Stopping);
  assert.equal(JSON.parse((await wrapperRequest(handler, '/status')).body).ok, false);
  await until(() => session.clock.waiting(SyncSettings.QuietMs), 'the quiet wait');
  session.clock.fire(SyncSettings.QuietMs);
  await session.task;
  const phases = session.states.slice(marker - 1).map((next) => next.phase);
  const firstStopped = phases.indexOf(SyncPhase.Stopped);
  assert.ok(firstStopped > 0);
  assert.ok(phases.slice(0, firstStopped).every((phase) => phase === SyncPhase.Stopping), phases.join(','));
  assert.ok(phases.slice(firstStopped).every((phase) => phase === SyncPhase.Stopped), phases.join(','));
});

test('a pull asks to reload open tabs before SillyTavern starts, and a conflict at the timer is announced but never stops it', async (context) => {
  const lines = capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const alpha = await machine(root, 'alpha');
  const beta = await machine(root, 'beta');
  await put(alpha.dataRoot, starter);
  const first = launch(alpha, bucket.transport, { lines, name: 'alpha' });
  await idle(first);
  const second = launch(beta, bucket.transport, { lines, name: 'beta' });
  await idle(second);
  const reload = lines.indexOf('[universe] Pulled newer files from the cloud. Reload any open SillyTavern tabs.');
  assert.ok(reload !== -1 && reload < lines.indexOf('[test] beta child started'));
  assert.equal(await readFile(join(beta.dataRoot, story), 'utf8'), starter[story]);
  const edited = '{"m":"beta"}\n';
  await put(beta.dataRoot, { [story]: edited });
  second.clock.fire(SyncSettings.SaveIntervalMs);
  await until(() => second.latest.phase === SyncPhase.Running && cloudFiles(bucket).files[story] === digest(edited), "beta's save");
  first.clock.fire(SyncSettings.SaveIntervalMs);
  await until(() => first.latest.phase === SyncPhase.Conflict, 'the conflict');
  const conflict = first.latest.error;
  assert.match(conflict, /^The other PC saved newer changes at /);
  assert.equal(lines.filter((text) => text === `[universe] ${conflict}`).length, 1);
  assert.equal(first.stops, 0);
  await stop(first);
  assert.equal(lines.at(-1), `[universe] NOT SAVED TO CLOUD: ${conflict}`);
  assert.equal(await readFile(join(alpha.dataRoot, story), 'utf8'), starter[story]);
  await stop(second);
  assert.match(lines.at(-1), /^\[universe\] Saved to cloud at /);
});

test('an offline start runs SillyTavern, keeps contacting the cloud and saves on first contact', async (context) => {
  const lines = capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const alpha = await machine(root, 'alpha');
  await put(alpha.dataRoot, starter);
  const first = launch(alpha, line.transport);
  await idle(first);
  await stop(first);
  const edited = '{"m":"written offline"}\n';
  await put(alpha.dataRoot, { [story]: edited });
  line.down = true;
  const session = launch(alpha, line.transport);
  await until(() => session.starts === 1, 'SillyTavern to start offline');
  assert.equal(session.latest.phase, SyncPhase.Offline);
  assert.ok(lines.some((text) => text.startsWith('[universe] Cloud unreachable: not pulled.')));
  await until(() => /^Cloud unreachable: not pulled\. fetch failed Retrying in \d+ s\.$/.test(session.latest.error), 'a reported retry');
  line.down = false;
  await until(() => session.latest.phase === SyncPhase.Running && cloudFiles(bucket).files[story] === digest(edited), 'the reconnect save');
  assert.equal(session.stops, 0);
  assert.ok(session.clock.waiting(SyncSettings.SaveIntervalMs));
  await stop(session);
  assert.match(lines.at(-1), /^\[universe\] Saved to cloud at /);
});

test('an offline start whose first answer is an error reports it through the status and console and does not save', async (context) => {
  const lines = capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const alpha = await machine(root, 'alpha');
  await put(alpha.dataRoot, starter);
  const first = launch(alpha, line.transport);
  await idle(first);
  await stop(first);
  const saved = cloudFiles(bucket).head;
  await put(alpha.dataRoot, { [story]: '{"m":"written offline"}\n' });
  line.down = true;
  const session = launch(alpha, line.transport);
  await until(() => session.starts === 1, 'SillyTavern to start offline');
  const requestsBefore = bucket.requests.length;
  bucket.status(controlKey, 403);
  line.down = false;
  const refused = 'Cloud control read failed (HTTP 403).';
  await until(() => lines.includes(`[universe] ${refused}`), 'the refused contact on the console');
  assert.equal(session.latest.error, refused);
  assert.equal(session.latest.phase, SyncPhase.Offline);
  await pause(50);
  assert.equal(bucket.requests.length, requestsBefore + 1);
  assert.equal(cloudFiles(bucket).head, saved);
  await stop(session);
});

for (const [label, prepare, pattern] of [
  ['a bucket mismatch', (config) => put(config.stateRoot, {
    'sync.json': JSON.stringify({ bucket: 'other/bucket', revision: null, pending: null, files: {} }),
  }), /last synced with bucket other\/bucket, not the configured testaccount\/test-bucket/],
  ['a case-insensitive data folder', async (config) => {
    await put(config.stateRoot, { 'case-probe': '' });
    await link(join(config.stateRoot, 'case-probe'), join(config.stateRoot, 'CASE-PROBE'));
  }, /case-insensitive filesystem/],
]) {
  test(`${label} disables sync but starts SillyTavern`, async (context) => {
    const lines = capture(context);
    const root = await workspace(context);
    const bucket = new MemoryBucket();
    const alpha = await machine(root, 'alpha');
    await put(alpha.dataRoot, starter);
    await prepare(alpha);
    const session = launch(alpha, bucket.transport);
    await until(() => session.starts === 1, 'SillyTavern to start');
    const reason = session.latest.error;
    assert.equal(session.latest.phase, SyncPhase.Disabled);
    assert.match(reason, pattern);
    assert.ok(lines.includes(`[universe] ${reason}`));
    assert.equal(session.saveNow, null);
    assert.equal(session.clock.waiting(SyncSettings.SaveIntervalMs), false);
    await stop(session);
    assert.equal(session.stops, 1);
    assert.equal(lines.at(-1), `[universe] NOT SAVED TO CLOUD: ${reason}`);
    assert.deepEqual(bucket.requests, []);
  });
}

test('local-only mode never builds a cloud store and leaves the sync state alone', async (context) => {
  const lines = capture(context);
  context.mock.method(ProfileSync.prototype, 'start', () => assert.fail('local-only mode started cloud sync'));
  const root = await workspace(context);
  const application = join(root, 'alpha', 'SillyTavern');
  await put(application, { 'server.js': '' });
  const config = configuration({ ST_DIR: application, ST_DATA_ROOT: join(root, 'alpha', 'local', 'data') });
  assert.equal(config.credentials, null);
  const session = launch(config, () => assert.fail('local-only mode used the transport'));
  await until(() => session.starts === 1, 'SillyTavern to start');
  assert.equal(session.latest.phase, SyncPhase.Disabled);
  assert.equal(session.latest.error, 'Cloud save is not configured.');
  assert.equal(session.saveNow, null);
  await stop(session);
  assert.equal(session.stops, 1);
  assert.equal(session.latest.phase, SyncPhase.Stopped);
  assert.deepEqual(lines, ['[universe] Cloud save is not configured.']);
  assert.equal(await exists(config.stateRoot), false);
});

test('/save answers 202 at once, and presses during a save queue exactly one follow-up', async (context) => {
  capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const line = wire(bucket);
  const alpha = await machine(root, 'alpha');
  await put(alpha.dataRoot, starter);
  const state = {};
  const session = launch(alpha, line.transport, { onState: (next) => Object.assign(state, next) });
  const pressed = [];
  /**
   * @returns {?Promise<object>}
   */
  const save = () => {
    if (session.saveNow === null) {
      return null;
    }
    const started = session.saveNow();
    pressed.push(started);
    return started;
  };
  const handler = createWrapperHandler(state, 8767, save);
  const token = await csrfToken(handler);
  /**
   * @returns {Promise<object>}
   */
  const press = () => wrapperRequest(handler, '/save', 'POST', { origin, 'x-universe-csrf': token });
  const early = await press();
  assert.equal(early.code, 503);
  assert.equal(JSON.parse(early.body).phase, SyncPhase.Pulling);
  await idle(session);
  const first = '{"m":"first press"}\n';
  const second = '{"m":"second press"}\n';
  await put(alpha.dataRoot, { [story]: first });
  const held = Promise.withResolvers();
  const release = Promise.withResolvers();
  /**
   * @param {string} method
   * @param {string} key
   * @returns {Promise<void>}
   */
  line.before = async (method, key) => {
    if (method === 'PUT' && key === `${prefix}/blobs/${digest(first)}`) {
      held.resolve();
      await release.promise;
    }
  };
  /**
   * @returns {number}
   */
  const controlReads = () => bucket.requests.filter((request) => request.method === 'GET' && request.key === controlKey).length;
  /**
   * @returns {number}
   */
  const manifests = () => [...bucket.objects.keys()].filter((key) => key.startsWith(`${prefix}/manifests/`)).length;
  const readsBefore = controlReads();
  const manifestsBefore = manifests();
  const answer = await press();
  assert.equal(answer.code, 202);
  assert.equal(JSON.parse(answer.body).phase, SyncPhase.Saving);
  assert.equal(JSON.parse(answer.body).ok, false);
  await held.promise;
  await put(alpha.dataRoot, { [story]: second });
  assert.deepEqual([(await press()).code, (await press()).code], [202, 202]);
  release.resolve();
  await Promise.all(pressed);
  assert.equal(pressed.length, 3);
  assert.equal(controlReads() - readsBefore, 2);
  assert.equal(manifests() - manifestsBefore, 2);
  assert.equal(cloudFiles(bucket).files[story], digest(second));
  await stop(session);
  assert.equal((await press()).code, 503);
});

test('the wrapper keeps its routes, origin and CSRF checks and rate limit, and escapes the page message', async () => {
  const state = { phase: SyncPhase.Saving, error: null };
  let calls = 0;
  /**
   * @returns {Promise<void>}
   */
  const save = () => {
    calls += 1;
    return Promise.resolve();
  };
  const handler = createWrapperHandler(state, 8767, save);
  /**
   * @param {string} url
   * @param {string} [method]
   * @param {object} [headers]
   * @returns {Promise<object>}
   */
  const call = (url, method, headers) => wrapperRequest(handler, url, method, headers);
  const token = await csrfToken(handler);
  assert.equal((await call('/?check=1')).code, 200);
  assert.equal((await call('http://127.0.0.1:8767')).code, 200);
  assert.equal((await call('https://example.test')).code, 403);
  assert.equal((await call('http://example.test/./')).code, 404);
  assert.equal((await call('//status')).code, 404);
  assert.equal((await call('/local/data/default-user/secrets.json')).code, 404);
  assert.equal((await call('/', 'POST')).headers.Allow, 'GET, HEAD');
  assert.equal((await call('/status', 'HEAD')).body, undefined);
  assert.deepEqual(JSON.parse((await call('/status')).body), { phase: SyncPhase.Saving, error: null, ok: false });
  state.phase = SyncPhase.Running;
  assert.equal(JSON.parse((await call('/status')).body).ok, true);
  assert.equal((await call('/', 'GET', { host: 'other.example' })).code, 403);
  assert.equal((await call('/', 'GET', { origin: 'http://other.example' })).code, 403);
  assert.equal((await call('/save')).code, 405);
  const valid = { origin, 'x-universe-csrf': token };
  for (const extra of [{ origin: 'null' }, { origin: 'http://127.0.0.1:8000' }, { origin: undefined },
    { 'x-universe-csrf': 'wrong' }, { host: 'other.example' }]) {
    assert.equal((await call('/save', 'POST', { ...valid, ...extra })).code, 403);
  }
  assert.equal((await call('/save', 'POST', { ...valid, 'content-length': '12' })).code, 400);
  assert.equal((await call('/save', 'POST', { ...valid, 'transfer-encoding': 'chunked' })).code, 400);
  assert.equal(calls, 0);
  for (let press = 0; press < 12; press += 1) {
    assert.equal((await call('/save', 'POST', valid)).code, 202);
  }
  const limited = await call('/save', 'POST', valid);
  assert.equal(limited.code, 429);
  assert.equal(limited.headers['Retry-After'], '10');
  assert.equal(calls, 12);

  const local = createWrapperHandler({ phase: SyncPhase.Disabled, error: 'Bucket <b>&"\'$\' is off.' }, 8767, () => null);
  const page = (await wrapperRequest(local, '/')).body;
  assert.match(page, /<button type="button" id="save" disabled>Save now<\/button>/);
  assert.ok(page.includes('Bucket &#60;b&#62;&#38;&#34;&#39;$&#39; is off.'));
  assert.ok(!page.includes('<b>'));
  const refused = await wrapperRequest(local, '/save', 'POST', { origin, 'x-universe-csrf': await csrfToken(local) });
  assert.equal(refused.code, 503);
  assert.equal(JSON.parse(refused.body).error, 'Bucket <b>&"\'$\' is off.');
});

test('the child runs server.js with the data and config paths, only the watchdog preload and channel, and no cloud variables', async (context) => {
  const root = await workspace(context);
  const application = join(root, 'SillyTavern');
  const report = join(root, 'report.json');
  await put(application, {
    'server.js': `require('node:fs').writeFileSync(${JSON.stringify(report)}, JSON.stringify({
      args: process.argv.slice(2), execArgv: process.execArgv, cwd: process.cwd(), ipc: typeof process.send,
      env: Object.keys(process.env).sort(),
    }));`,
  });
  const child = startChild({
    sillyTavern: application,
    dataRoot: join(root, 'data'),
    configPath: join(root, 'config.yaml'),
    env: { PATH: process.env.PATH, KEEP: 'yes', R2_BUCKET: 'secret', AWS_REGION: 'x', cf_token: 'x', NODE_OPTIONS: '--require=x' },
  });
  assert.ok(child.pid > 0);
  assert.deepEqual(await child.finished, { code: 0, signal: null, launchError: null });
  const seen = JSON.parse(await readFile(report, 'utf8'));
  assert.deepEqual(seen.args, ['--dataRoot', join(root, 'data'), '--configPath', join(root, 'config.yaml')]);
  assert.deepEqual(seen.execArgv, ['--import', pathToFileURL(join(project, 'src', 'child-watchdog.mjs')).href]);
  assert.equal(seen.cwd, application);
  assert.equal(seen.ipc, 'function');
  assert.deepEqual(seen.env, ['KEEP', 'PATH']);
});

test('stop sends SIGTERM, and kills a child that ignores it after 15 seconds', async (context) => {
  const root = await workspace(context);
  const application = join(root, 'SillyTavern');
  const ready = join(root, 'ready');
  await put(application, {
    'server.js': `process.on('SIGTERM', () => require('node:fs').writeFileSync(${JSON.stringify(join(root, 'termed'))}, ''));
      require('node:fs').writeFileSync(${JSON.stringify(ready)}, '');
      setInterval(() => {}, 1000);`,
  });
  const child = startChild({ sillyTavern: application, dataRoot: join(root, 'data'), env: {} });
  await until(() => exists(ready), 'the child to install its SIGTERM handler');
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const stopping = child.stop().finally(() => {
    settled = true;
  });
  const deadline = Date.now() + 10_000;
  while (!(await exists(join(root, 'termed')))) {
    assert.ok(Date.now() < deadline, 'SIGTERM never arrived');
    await nextTurn();
  }
  context.mock.timers.tick(14_999);
  const grace = Date.now() + 100;
  while (Date.now() < grace) {
    await nextTurn();
  }
  assert.equal(settled, false);
  context.mock.timers.tick(1);
  assert.deepEqual(await stopping, { code: null, signal: 'SIGKILL', launchError: null });
});

test('a child that cannot launch resolves finished with the launch error', async (context) => {
  const root = await workspace(context);
  const child = startChild({ sillyTavern: join(root, 'missing'), dataRoot: join(root, 'data'), env: {} });
  assert.equal(child.pid, null);
  const result = await child.finished;
  assert.equal(result.launchError.code, 'ENOENT');
  assert.deepEqual(await child.stop(), result);
});

test('SillyTavern exiting by itself is treated like Ctrl+C: the last writes go up after the quiet wait', async (context) => {
  const lines = capture(context);
  const root = await workspace(context);
  const bucket = new MemoryBucket();
  const alpha = await machine(root, 'alpha');
  await put(alpha.dataRoot, starter);
  const last = '{"m":"last words"}\n';
  await put(alpha.sillyTavern, {
    'server.js': `const data = process.argv[process.argv.indexOf('--dataRoot') + 1];
      require('node:fs').writeFileSync(require('node:path').join(data, ${JSON.stringify(story)}), ${JSON.stringify(last)});
      process.exit(3);`,
  });
  const clock = testClock();
  clock.hold = true;
  const states = [];
  const task = runLauncher(alpha, new AbortController().signal, (state) => states.push(state), { transport: bucket.transport, clock });
  await until(() => clock.waiting(SyncSettings.QuietMs), 'the quiet wait after SillyTavern exited');
  assert.ok(states.some((state) => state.phase === SyncPhase.Stopping));
  clock.fire(SyncSettings.QuietMs);
  await task;
  assert.match(lines.at(-1), /^\[universe\] Saved to cloud at /);
  assert.equal(cloudFiles(bucket).files[story], digest(last));
});
