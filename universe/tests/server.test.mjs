import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { LauncherLog } from '../src/LauncherLog.mjs';
import { FileErrors } from '../src/sync/FileErrors.mjs';

const project = dirname(import.meta.dirname);
const defaultPort = 8767;

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 * @throws {Error}
 */
async function exists(path) {
  return (await FileErrors.missing(stat(path))) !== null;
}

/**
 * @param {Function} predicate
 * @param {string} what
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function until(predicate, what) {
  const deadline = Date.now() + 20_000;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      assert.fail(`Timed out waiting for ${what}.`);
    }
    await pause(5);
  }
}

/**
 * @param {number} pid
 * @returns {boolean}
 * @throws {Error}
 */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
    return false;
  }
}

/**
 * @param {number} port
 * @returns {Promise<?number>}
 * @throws {Error}
 */
async function probePort(port) {
  const socket = createServer();
  try {
    await new Promise((listening, reject) => socket.once('error', reject).listen(port, '127.0.0.1', listening));
  } catch (error) {
    if (error.code !== 'EADDRINUSE') {
      throw error;
    }
    return null;
  }
  const bound = socket.address().port;
  await new Promise((closed) => socket.close(closed));
  return bound;
}

/**
 * @param {import('node:test').TestContext} context
 * @returns {Promise<{root: string, settings: string, log: string, pidFile: string, termed: string, createdAt: string, runs: object[]}>}
 * @throws {Error}
 */
async function temporaryUniverse(context) {
  const root = await mkdtemp(join(tmpdir(), 'universe-server-'));
  const universe = {
    root,
    settings: join(root, '.env'),
    log: join(root, 'local', 'logs', 'launcher.log'),
    pidFile: join(root, 'sillytavern.pid'),
    termed: join(root, 'sillytavern-termed'),
    createdAt: new Date().toISOString(),
    runs: [],
  };
  context.after(async () => {
    for (const run of universe.runs) {
      if (run.launcher.exitCode === null && run.launcher.signalCode === null) {
        run.launcher.kill('SIGKILL');
        await run.exited;
      }
    }
    const recorded = (await exists(universe.pidFile)) ? Number(await readFile(universe.pidFile, 'utf8')) : 0;
    if (recorded > 0 && alive(recorded) && (await FileErrors.missing(readFile(`/proc/${recorded}/cmdline`, 'utf8')))?.includes(root)) {
      process.kill(recorded, 'SIGKILL');
    }
    await rm(root, { recursive: true, force: true });
  });
  await cp(join(project, 'src'), join(root, 'src'), { recursive: true });
  const application = join(root, 'node_modules', 'sillytavern');
  await mkdir(application, { recursive: true });
  await writeFile(join(application, 'server.js'), `const fs = require('node:fs');
    process.on('SIGTERM', () => {
      fs.writeFileSync(${JSON.stringify(universe.termed)}, '');
      process.exit(0);
    });
    fs.writeFileSync(${JSON.stringify(universe.pidFile)}, String(process.pid));
    setInterval(() => {}, 1000);
  `);
  return universe;
}

/**
 * @param {{root: string, runs: object[]}} universe
 * @param {boolean} [consoleGone]
 * @returns {{launcher: import('node:child_process').ChildProcess, output: {stdout: string, stderr: string}, exited: Promise<object>, closed: Promise<object>}}
 * @throws {TypeError}
 */
function startLauncher(universe, consoleGone = false) {
  const launcher = spawn(process.execPath, [join(universe.root, 'src', 'server.mjs')], {
    cwd: universe.root, env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const run = {
    launcher,
    output: { stdout: '', stderr: '' },
    exited: new Promise((resolve) => launcher.once('exit', (code, signal) => resolve({ code, signal }))),
    closed: new Promise((resolve) => launcher.once('close', (code, signal) => resolve({ code, signal }))),
  };
  universe.runs.push(run);
  if (consoleGone) {
    launcher.stdout.destroy();
  } else {
    launcher.stdout.setEncoding('utf8').on('data', (text) => {
      run.output.stdout += text;
    });
  }
  launcher.stderr.setEncoding('utf8').on('data', (text) => {
    run.output.stderr += text;
  });
  return run;
}

/**
 * @param {{log: string, createdAt: string}} universe
 * @returns {Promise<string[]>}
 * @throws {Error}
 */
async function logged(universe) {
  const text = await readFile(universe.log, 'utf8');
  assert.ok(text.endsWith('\n'), `the log ends inside a line: ${text}`);
  let previous = universe.createdAt;
  return text.slice(0, -1).split('\n').map((entry) => {
    const [, stamp, line] = /^(\S+) (.*)$/.exec(entry);
    assert.equal(new Date(stamp).toISOString(), stamp);
    assert.ok(stamp >= previous, `${stamp} is earlier than ${previous}`);
    previous = stamp;
    return line;
  });
}

/**
 * @param {{pidFile: string}} universe
 * @param {{launcher: import('node:child_process').ChildProcess, output: {stderr: string}}} run
 * @returns {Promise<number>}
 * @throws {Error}
 */
async function sillyTavernStarted(universe, run) {
  let pid = 0;
  await until(async () => {
    assert.ok(run.launcher.exitCode === null && run.launcher.signalCode === null,
      `The launcher ended before SillyTavern started: ${run.output.stderr}`);
    pid = (await exists(universe.pidFile)) ? Number(await readFile(universe.pidFile, 'utf8')) : 0;
    return pid > 0;
  }, 'SillyTavern to start');
  return pid;
}

for (const [label, consoleGone] of [['with the console open', false], ['after the console reader is gone', true]]) {
  test(`SIGHUP ${label} stops SillyTavern with SIGTERM, the launcher exits 0 and the log holds its lines`, async (context) => {
    const universe = await temporaryUniverse(context);
    const port = await probePort(0);
    await writeFile(universe.settings, `UNIVERSE_PORT=${port}\n`);
    const run = startLauncher(universe, consoleGone);
    const pid = await sillyTavernStarted(universe, run);
    if (!consoleGone) {
      await until(() => run.output.stdout.includes('[universe] Cloud save is not configured.\n'), 'the local-only line');
    }
    run.launcher.kill('SIGHUP');
    assert.deepEqual(await run.closed, { code: 0, signal: null });
    assert.equal(run.output.stderr, '');
    assert.equal(await exists(universe.termed), true);
    assert.equal(alive(pid), false);
    assert.deepEqual(await logged(universe), [`http://127.0.0.1:${port}/`, '[universe] Cloud save is not configured.']);
  });
}

for (const [label, prepare, failure, rootPasses] of [
  [
    'a directory',
    /**
     * @param {string} path
     * @returns {Promise<void>}
     * @throws {Error}
     */
    async (path) => {
      await mkdir(path);
    },
    null,
    false,
  ],
  [
    'a dangling symbolic link',
    /**
     * @param {string} path
     * @returns {Promise<void>}
     * @throws {Error}
     */
    async (path) => {
      await symlink(join(dirname(path), 'missing-settings'), path);
    },
    null,
    false,
  ],
  [
    'an unreadable file',
    /**
     * @param {string} path
     * @returns {Promise<void>}
     * @throws {Error}
     */
    async (path) => {
      await writeFile(path, 'UNIVERSE_PORT=9\n');
      await chmod(path, 0o000);
    },
    'EACCES: permission denied, open',
    true,
  ],
  [
    'a symbolic link to itself',
    /**
     * @param {string} path
     * @returns {Promise<void>}
     * @throws {Error}
     */
    async (path) => {
      await symlink(path, path);
    },
    'ELOOP: too many symbolic links encountered, stat',
    false,
  ],
  [
    'a symbolic link into a folder with mode 000',
    /**
     * @param {string} path
     * @param {import('node:test').TestContext} context
     * @returns {Promise<void>}
     * @throws {Error}
     */
    async (path, context) => {
      const locked = await mkdtemp(join(tmpdir(), 'universe-locked-'));
      context.after(async () => {
        await chmod(locked, 0o700);
        await rm(locked, { recursive: true, force: true });
      });
      await writeFile(join(locked, 'settings'), 'UNIVERSE_PORT=9\n');
      await chmod(locked, 0o000);
      await symlink(join(locked, 'settings'), path);
    },
    'EACCES: permission denied, stat',
    true,
  ],
]) {
  test(`a project .env that is ${label} stops the launcher with exit 1 before SillyTavern starts and logs why`, {
    skip: rootPasses && process.getuid() === 0 ? 'root passes mode 000' : false,
  }, async (context) => {
    const universe = await temporaryUniverse(context);
    await prepare(universe.settings, context);
    const run = startLauncher(universe);
    assert.deepEqual(await run.closed, { code: 1, signal: null });
    const unusable = `The Universe settings file ${universe.settings} must be a readable regular file.`;
    const detail = failure === null ? '' : ` ${failure} '${universe.settings}'`;
    assert.equal(run.output.stderr, `[universe] ${unusable}${detail}\n`);
    assert.equal(run.output.stdout, '');
    assert.equal(await exists(universe.pidFile), false);
    assert.deepEqual(await logged(universe), [`[universe] ${unusable}${detail}`]);
  });
}

test('a local-only run stopped with SIGINT logs its console lines with timestamps, and the next run appends after them', async (context) => {
  const universe = await temporaryUniverse(context);
  const port = await probePort(0);
  await writeFile(universe.settings, `UNIVERSE_PORT=${port}\n`);
  const lines = [`http://127.0.0.1:${port}/`, '[universe] Cloud save is not configured.'];
  for (let round = 1; round <= 2; round += 1) {
    await rm(universe.pidFile, { force: true });
    await rm(universe.termed, { force: true });
    const run = startLauncher(universe);
    await sillyTavernStarted(universe, run);
    await until(() => run.output.stdout.includes('[universe] Cloud save is not configured.\n'), 'the local-only line');
    run.launcher.kill('SIGINT');
    assert.deepEqual(await run.closed, { code: 0, signal: null });
    assert.equal(run.output.stderr, '');
    assert.equal(run.output.stdout, `${lines.join('\n')}\n`);
    assert.equal(await exists(universe.termed), true);
    assert.deepEqual(await logged(universe), Array.from({ length: round }, () => lines).flat());
  }
});

test('a log folder that cannot be created is reported once on the console, and SillyTavern still starts and stops normally', async (context) => {
  const universe = await temporaryUniverse(context);
  const port = await probePort(0);
  const logs = dirname(universe.log);
  await writeFile(universe.settings, `UNIVERSE_PORT=${port}\n`);
  await mkdir(dirname(logs), { recursive: true });
  await writeFile(logs, '');
  const run = startLauncher(universe);
  await sillyTavernStarted(universe, run);
  await until(() => run.output.stdout.includes('[universe] Cloud save is not configured.\n'), 'the local-only line');
  run.launcher.kill('SIGINT');
  assert.deepEqual(await run.closed, { code: 0, signal: null });
  assert.equal(run.output.stderr, '');
  assert.equal(await exists(universe.termed), true);
  assert.equal(run.output.stdout, [
    `[universe] Could not write the log file ${universe.log}: EEXIST: file already exists, mkdir '${logs}'`,
    `http://127.0.0.1:${port}/`,
    '[universe] Cloud save is not configured.',
    '',
  ].join('\n'));
  assert.equal(await readFile(logs, 'utf8'), '');
});

test('a project without .env starts SillyTavern in local-only mode', async (context) => {
  if ((await probePort(defaultPort)) === null) {
    context.skip(`port ${defaultPort} is in use`);
    return;
  }
  const universe = await temporaryUniverse(context);
  const run = startLauncher(universe);
  await sillyTavernStarted(universe, run);
  await until(() => run.output.stdout.includes('[universe] Cloud save is not configured.\n'), 'the local-only line');
  assert.equal(run.output.stdout, `http://127.0.0.1:${defaultPort}/\n[universe] Cloud save is not configured.\n`);
  run.launcher.kill('SIGINT');
  assert.deepEqual(await run.closed, { code: 0, signal: null });
  assert.equal(run.output.stderr, '');
  assert.equal(await exists(universe.termed), true);
});

test('the served page carries its CSP nonce on its one style and one script, has no inline style, and /status carries every field it reads', async (context) => {
  const universe = await temporaryUniverse(context);
  const port = await probePort(0);
  await writeFile(universe.settings, `UNIVERSE_PORT=${port}\n`);
  const run = startLauncher(universe);
  await sillyTavernStarted(universe, run);
  await until(() => run.output.stdout.includes('[universe] Cloud save is not configured.\n'), 'the local-only line');
  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  const policy = response.headers.get('content-security-policy');
  const nonce = /style-src 'nonce-([^']+)'/.exec(policy)[1];
  assert.equal(policy, `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; ` +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  const page = await response.text();
  assert.deepEqual(page.match(/<style\b[^>]*>/g), [`<style nonce="${nonce}">`]);
  assert.deepEqual(page.match(/<script\b[^>]*>/g), [`<script nonce="${nonce}">`]);
  assert.doesNotMatch(page, /<[^>]*\sstyle\s*=/i);
  assert.doesNotMatch(page, /<[^>]*\son[a-z]+\s*=/i);
  assert.doesNotMatch(page, /\.style\b/);
  assert.doesNotMatch(page, /\{\{|}}/);
  assert.match(page, /<button type="button" id="save" disabled>Save now<\/button>/);
  assert.match(page, /<p id="result" role="status" aria-live="polite">Cloud save is not configured\.<\/p>/);
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(page)[1];
  const ids = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.equal(page.split(` id="${id}"`).length, 2, `the page has not exactly one #${id}`);
  }
  const fields = new Set([...script.matchAll(/\bstatus\.(\w+)/g)].map((match) => match[1]));
  assert.ok(fields.has('phase') && fields.has('progress'), [...fields].join(', '));
  const status = await (await fetch(`http://127.0.0.1:${port}/status`)).json();
  for (const field of fields) {
    assert.ok(Object.hasOwn(status, field), `/status lacks ${field}`);
  }
  run.launcher.kill('SIGINT');
  assert.deepEqual(await run.closed, { code: 0, signal: null });
  assert.equal(run.output.stderr, '');
});

test('SillyTavern is gone within 2 s after the launcher is killed with SIGKILL, and the log keeps the lines written before it', async (context) => {
  const universe = await temporaryUniverse(context);
  const port = await probePort(0);
  await writeFile(universe.settings, `UNIVERSE_PORT=${port}\n`);
  const run = startLauncher(universe);
  const pid = await sillyTavernStarted(universe, run);
  run.launcher.kill('SIGKILL');
  const deadline = Date.now() + 2_000;
  assert.deepEqual(await run.exited, { code: null, signal: 'SIGKILL' });
  while (alive(pid)) {
    assert.ok(Date.now() < deadline, 'SillyTavern outlived the launcher by more than 2 s');
    await pause(10);
  }
  assert.equal(await exists(universe.termed), true);
  assert.deepEqual(await logged(universe), [`http://127.0.0.1:${port}/`, '[universe] Cloud save is not configured.']);
});

test('the launcher log has each line on disk with its ISO 8601 UTC time as soon as write or say returns', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'universe-log-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'local', 'logs', 'launcher.log');
  const log = new LauncherLog(path);
  const shown = [];
  /**
   * @param {string} line
   * @returns {void}
   */
  const show = (line) => {
    shown.push(line);
  };
  const url = `http://127.0.0.1:${defaultPort}/`;
  const startedAt = new Date().toISOString();
  log.write(url, show);
  const afterWrite = readFileSync(path, 'utf8');
  log.say('Cloud save is not configured.', show);
  const afterSay = readFileSync(path, 'utf8');
  const finishedAt = new Date().toISOString();
  assert.deepEqual(shown, [url, '[universe] Cloud save is not configured.']);
  const writeStamp = afterWrite.slice(0, afterWrite.indexOf(' '));
  assert.equal(afterWrite, `${writeStamp} ${url}\n`);
  const sayStamp = afterSay.slice(afterWrite.length, afterSay.indexOf(' ', afterWrite.length));
  assert.equal(afterSay, `${afterWrite}${sayStamp} [universe] Cloud save is not configured.\n`);
  for (const stamp of [writeStamp, sayStamp]) {
    assert.equal(new Date(stamp).toISOString(), stamp);
    assert.ok(startedAt <= stamp && stamp <= finishedAt, `${stamp} is outside ${startedAt} to ${finishedAt}`);
  }
});
